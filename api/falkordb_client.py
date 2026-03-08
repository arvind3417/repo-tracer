"""FalkorDB query client using the Redis protocol."""

import os
import logging
from typing import Any

logger = logging.getLogger(__name__)


class FalkorDBClient:
    """Client for querying FalkorDB graphs via the Redis protocol."""

    def __init__(
        self,
        host: str | None = None,
        port: int | None = None,
    ) -> None:
        self.host = host or os.environ.get("FALKORDB_HOST", "localhost")
        self.port = int(port or os.environ.get("FALKORDB_PORT", 6379))
        self._redis = None
        self._available: bool | None = None  # None = not yet checked

    def _get_redis(self):
        """Lazily connect to Redis / FalkorDB."""
        if self._redis is None:
            import redis  # type: ignore

            self._redis = redis.Redis(
                host=self.host,
                port=self.port,
                decode_responses=True,
                socket_connect_timeout=2,
                socket_timeout=5,
            )
        return self._redis

    def is_available(self) -> bool:
        """Return True if FalkorDB is reachable."""
        if self._available is True:
            return True
        try:
            self._get_redis().ping()
            self._available = True
            return True
        except Exception as exc:
            logger.warning("FalkorDB not reachable at %s:%s — %s", self.host, self.port, exc)
            self._available = False
            return False

    # ------------------------------------------------------------------
    # Public query helpers
    # ------------------------------------------------------------------

    def list_graphs(self) -> list[str]:
        """List all available FalkorDB graphs (workspaces)."""
        if not self.is_available():
            return []
        try:
            result = self._get_redis().execute_command("GRAPH.LIST")
            if result is None:
                return []
            return list(result)
        except Exception as exc:
            logger.error("GRAPH.LIST failed: %s", exc)
            return []

    def query(self, graph: str, cypher: str, params: dict | None = None) -> list[dict]:
        """Execute a Cypher query and return results as a list of dicts.

        Uses --compact flag for efficient response format.
        """
        if not self.is_available():
            return []
        try:
            r = self._get_redis()
            if params:
                cypher = self._interpolate_params(cypher, params)
            # Use non-compact mode — values come back as plain Python scalars,
            # no schema lookup needed to decode property key IDs.
            raw = r.execute_command("GRAPH.QUERY", graph, cypher)
            return self._parse_result_plain(raw)
        except Exception as exc:
            logger.error("GRAPH.QUERY on '%s' failed: %s", graph, exc)
            return []

    def graph_stats(self, graph: str) -> dict:
        """Return basic stats for a graph: node_count."""
        rows = self.query(graph, "MATCH (n) RETURN count(n) AS node_count")
        if rows:
            return {"node_count": rows[0].get("node_count", 0)}
        return {"node_count": 0}

    # ------------------------------------------------------------------
    # Internal parsing helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _interpolate_params(cypher: str, params: dict) -> str:
        """Simple string-based param substitution (safe for integers/strings)."""
        for key, val in params.items():
            placeholder = f"${key}"
            if isinstance(val, str):
                cypher = cypher.replace(placeholder, f"'{val}'")
            else:
                cypher = cypher.replace(placeholder, str(val))
        return cypher

    def _parse_result_plain(self, raw: Any) -> list[dict]:
        """Parse non-compact FalkorDB result: [header, rows, stats].

        Non-compact format:
          header: ['col_name', ...]
          rows:   [[scalar_or_node_dict, ...], ...]
        Node values are returned as dicts with 'id', 'labels', and property keys.
        Scalar values are plain Python strings/ints/floats/None.
        """
        if not raw or not isinstance(raw, (list, tuple)) or len(raw) < 2:
            return []

        header = raw[0]   # plain list of column name strings
        rows   = raw[1] if len(raw) > 1 else []

        col_names = [str(c) for c in header] if header else []

        results: list[dict] = []
        for row in rows:
            if not isinstance(row, (list, tuple)):
                continue
            record: dict = {}
            for i, val in enumerate(row):
                col = col_names[i] if i < len(col_names) else str(i)
                record[col] = self._decode_plain_value(val)
            results.append(record)
        return results

    def _decode_plain_value(self, val: Any) -> Any:
        """Decode a value from non-compact FalkorDB results.

        Scalars (str, int, float, None) are returned as-is.
        Node dicts have the shape {'id': N, 'labels': [...], **properties}.
        """
        if val is None or isinstance(val, (str, int, float, bool)):
            return val
        if isinstance(val, (list, tuple)):
            # Edge from FalkorDB can arrive as key-value tuples:
            # [["id", 1], ["type", "IMPORTS"], ["src_node", 2], ["dest_node", 3], ["properties", []]]
            if val and all(
                isinstance(item, (list, tuple)) and len(item) == 2 and isinstance(item[0], str)
                for item in val
            ):
                kv = {k: self._decode_plain_value(v) for k, v in val}
                if {"id", "type", "src_node", "dest_node"}.issubset(kv.keys()):
                    props = kv.get("properties", {})
                    if isinstance(props, list):
                        # properties can be [] or [["k","v"], ...]
                        try:
                            props = {p[0]: self._decode_plain_value(p[1]) for p in props if isinstance(p, (list, tuple)) and len(p) == 2}
                        except Exception:
                            props = {}
                    if not isinstance(props, dict):
                        props = {}
                    return {
                        "id": kv["id"],
                        "type": kv["type"],
                        "source": kv["src_node"],
                        "target": kv["dest_node"],
                        **props,
                    }
                return kv
            # Could be a node: [id, [labels], {props}] or just a list value
            if (len(val) == 3
                    and isinstance(val[0], int)
                    and isinstance(val[1], list)):
                # node: [id, labels_list, props_dict_or_list]
                node_id = val[0]
                labels  = val[1]
                props   = val[2] if len(val) > 2 else {}
                if isinstance(props, dict):
                    return {"id": node_id, "labels": labels, **props}
                return {"id": node_id, "labels": labels}
            return [self._decode_plain_value(v) for v in val]
        if isinstance(val, dict):
            return {k: self._decode_plain_value(v) for k, v in val.items()}
        return val

    def _parse_result(self, raw: Any) -> list[dict]:
        """Legacy compact parser — kept for reference but no longer used."""
        return self._parse_result_plain(raw)

    def _decode_value(self, val: Any) -> Any:
        """Decode a FalkorDB compact value.

        Each value is a 2-element list: [type_code, data]
        type codes:
          1 = node
          2 = relationship/edge
          3 = string
          4 = integer
          5 = null
          6 = boolean
          7 = double
          8 = array
          9 = edge (alternate code)
        """
        if isinstance(val, (list, tuple)) and len(val) == 2:
            type_code, data = val
            try:
                type_code = int(type_code)
            except (TypeError, ValueError):
                return val

            if type_code == 1:
                return self._decode_node(data)
            elif type_code == 2 or type_code == 9:
                return self._decode_edge(data)
            elif type_code == 3:
                return data  # string
            elif type_code == 4:
                try:
                    return int(data)
                except (TypeError, ValueError):
                    return data
            elif type_code == 5:
                return None
            elif type_code == 6:
                return bool(data)
            elif type_code == 7:
                try:
                    return float(data)
                except (TypeError, ValueError):
                    return data
            elif type_code == 8:
                if isinstance(data, (list, tuple)):
                    return [self._decode_value(item) for item in data]
                return data
        # Scalar (already decoded by redis-py decode_responses=True)
        if isinstance(val, str):
            # Try to coerce numeric strings
            try:
                return int(val)
            except (TypeError, ValueError):
                pass
        return val

    def _decode_node(self, data: Any) -> dict:
        """Decode a FalkorDB node into a dict.

        Node data: [id, [labels], [[key, type, value], ...]]
        """
        if not isinstance(data, (list, tuple)):
            return {}
        node_id = data[0] if len(data) > 0 else None
        labels = list(data[1]) if len(data) > 1 and isinstance(data[1], (list, tuple)) else []
        props: dict = {}
        if len(data) > 2 and isinstance(data[2], (list, tuple)):
            for prop in data[2]:
                if isinstance(prop, (list, tuple)) and len(prop) >= 3:
                    key = str(prop[0])
                    # prop[1] is type code, prop[2] is value
                    props[key] = self._decode_value([prop[1], prop[2]])
        return {"id": node_id, "labels": labels, **props}

    def _decode_edge(self, data: Any) -> dict:
        """Decode a FalkorDB edge/relationship into a dict.

        Edge data: [id, type, src_id, dest_id, [[key, type, value], ...]]
        """
        if not isinstance(data, (list, tuple)):
            return {}
        edge_id = data[0] if len(data) > 0 else None
        rel_type = data[1] if len(data) > 1 else ""
        src_id = data[2] if len(data) > 2 else None
        dst_id = data[3] if len(data) > 3 else None
        props: dict = {}
        if len(data) > 4 and isinstance(data[4], (list, tuple)):
            for prop in data[4]:
                if isinstance(prop, (list, tuple)) and len(prop) >= 3:
                    key = str(prop[0])
                    props[key] = self._decode_value([prop[1], prop[2]])
        return {
            "id": edge_id,
            "type": rel_type,
            "source": src_id,
            "target": dst_id,
            **props,
        }
