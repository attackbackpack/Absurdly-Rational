const SEGMENT = /^([A-Za-z0-9_]+)(?:\[([A-Za-z0-9_]+)=([^\]]*)\])?$/;
const LIQUID = /\{\{[^}]*\}\}/;

export function parseSpec(spec) {
  const colon = String(spec).indexOf(":");
  if (colon < 1) {
    throw new Error(`"${spec}": missing a data file prefix such as "site:"`);
  }
  const file = spec.slice(0, colon);
  const rest = spec.slice(colon + 1).trim();
  if (!rest) {
    throw new Error(`"${spec}": empty path after the file prefix`);
  }

  const segments = [];
  let remaining = rest;

  while (remaining) {
    // Find the next dot that's not inside brackets
    let bracketDepth = 0;
    let dotIndex = -1;
    for (let i = 0; i < remaining.length; i++) {
      if (remaining[i] === "[") bracketDepth++;
      else if (remaining[i] === "]") bracketDepth--;
      else if (remaining[i] === "." && bracketDepth === 0) {
        dotIndex = i;
        break;
      }
    }

    const part = dotIndex === -1 ? remaining : remaining.slice(0, dotIndex);

    const match = SEGMENT.exec(part);
    if (!match) {
      throw new Error(`"${spec}": cannot parse path segment "${part}"`);
    }
    const [, name, matchKey, matchValue] = match;
    segments.push({ kind: "key", name });
    if (matchKey !== undefined) {
      // "index" is a reserved match key: it selects an array member by
      // position (see walk()) rather than by matching a field named
      // "index". A collection must not have a literal "index" field.
      segments.push({
        kind: "match",
        key: matchKey,
        value: LIQUID.test(matchValue) ? null : matchValue
      });
    }

    remaining = dotIndex === -1 ? "" : remaining.slice(dotIndex + 1);
  }

  return { file, segments };
}

function describe(segments, upto) {
  return segments
    .slice(0, upto + 1)
    .map((s) => (s.kind === "key" ? s.name : `[${s.key}=${s.value ?? "*"}]`))
    .join(".");
}

function walk(data, segments, stopBefore) {
  let cursor = data;
  const limit = stopBefore === undefined ? segments.length : stopBefore;
  for (let i = 0; i < limit; i += 1) {
    const segment = segments[i];
    if (cursor === null || typeof cursor !== "object") {
      throw new Error(`${describe(segments, i)}: parent is not an object`);
    }
    if (segment.kind === "key") {
      if (!(segment.name in cursor)) {
        throw new Error(`${describe(segments, i)}: no such key`);
      }
      cursor = cursor[segment.name];
    } else {
      if (!Array.isArray(cursor)) {
        throw new Error(`${describe(segments, i)}: expected an array`);
      }
      if (segment.key === "index") {
        // Position-based match: select by array index rather than by a
        // field. See the reservation note in parseSpec above.
        //
        // [index=N] and [key=…]/[url=…] degrade differently when the rendered
        // preview is stale relative to the draft — say an item was removed
        // through another editor session since the iframe last loaded. A key-based spec
        // throws ("no member with key=x") and the edit is visibly refused. An
        // index-based one still resolves, silently, to whatever now sits at
        // that position, and writes the edit to the WRONG item. Prefer a
        // stable key wherever the data has one; reach for [index=N] only for
        // a genuinely positional list (podcasts guest links have no key), and
        // know what you are trading away.
        const idx = Number(segment.value);
        if (!Number.isInteger(idx) || idx < 0 || idx >= cursor.length) {
          throw new Error(`${describe(segments, i)}: index ${segment.value} out of range`);
        }
        cursor = cursor[idx];
      } else {
        const found = cursor.find((item) => item && item[segment.key] === segment.value);
        if (found === undefined) {
          throw new Error(`${describe(segments, i)}: no member with ${segment.key}=${segment.value}`);
        }
        cursor = found;
      }
    }
  }
  return cursor;
}

export function getValue(data, segments) {
  return walk(data, segments);
}

export function setValue(data, segments, value) {
  const last = segments[segments.length - 1];
  if (!last || last.kind !== "key") {
    throw new Error("setValue requires a path ending in a key");
  }
  const parent = walk(data, segments, segments.length - 1);
  if (parent === null || typeof parent !== "object") {
    throw new Error(`${describe(segments, segments.length - 2)}: parent is not an object`);
  }
  parent[last.name] = value;
}

/**
 * Every value a Liquid-interpolated spec can resolve to, across EVERY wildcard
 * in it — not just the first.
 *
 * A compound spec such as
 *   podcasts:guests[key={{ guest.key }}].links[index={{ forloop.index0 }}].label
 * has two wildcards. Expanding only the first left the second to fall through
 * to walk(), where [index=null] became Number(null) === 0 — so the spec proved
 * "the first link of every guest" and a missing label on any later link sailed
 * past the build. Recursing on the tail expands each wildcard in turn, so the
 * trailing field is proved on every combination.
 */
export function collectMatches(data, segments) {
  const wildcardAt = segments.findIndex((s) => s.kind === "match" && s.value === null);
  if (wildcardAt === -1) {
    return [getValue(data, segments)];
  }
  const array = walk(data, segments, wildcardAt);
  if (!Array.isArray(array)) {
    throw new Error(`${describe(segments, wildcardAt)}: expected an array`);
  }
  const tail = segments.slice(wildcardAt + 1);
  const values = [];
  array.forEach((member, index) => {
    try {
      values.push(...collectMatches(member, tail));
    } catch (error) {
      throw new Error(`${describe(segments, wildcardAt)}[${index}]: ${error.message}`);
    }
  });
  return values;
}
