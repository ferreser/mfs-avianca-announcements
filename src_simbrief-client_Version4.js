/**
 * Cliente mínimo robusto para SimBrief (XML -> JSON)
 * Usa SIMBRIEF_USERNAME y SIMBRIEF_API_KEY en env
 */

const fetch = require("node-fetch");
const { XMLParser } = require("fast-xml-parser");
const log = require("pino")();

const SIMBRIEF_API_URL = process.env.SIMBRIEF_API_URL || "https://www.simbrief.com/api/xml.fetch_flightplan";

function _findFirstKey(obj, candidates) {
  if (!obj || typeof obj !== "object") return undefined;
  const keys = Object.keys(obj);
  for (const cand of candidates) {
    for (const k of keys) {
      if (k.toLowerCase() === cand.toLowerCase()) return obj[k];
    }
  }
  for (const k of keys) {
    const val = obj[k];
    if (typeof val === "object") {
      const found = _findFirstKey(val, candidates);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

function _extractField(json, candidateNames) {
  try {
    const v = _findFirstKey(json, candidateNames);
    if (typeof v === "string") return v;
    if (typeof v === "object") {
      if ("#text" in v) return v["#text"];
      if ("@_value" in v) return v["@_value"];
    }
    return undefined;
  } catch (err) {
    return undefined;
  }
}

function extractFlightInfo(parsedJson) {
  const flightNumber = _extractField(parsedJson, ["flight_number", "fltno", "flight", "flightnum", "flt"]);
  const departure = _extractField(parsedJson, ["dep_icao", "departure", "dep", "orig"]);
  const arrival = _extractField(parsedJson, ["arr_icao", "arrival", "dest", "destination", "arr"]);
  const eta = _extractField(parsedJson, ["eta", "arrival_time", "eobt"]);
  return {
    raw: parsedJson,
    flight_number: flightNumber || "",
    departure: departure || "",
    arrival: arrival || "",
    eta: eta || ""
  };
}

async function fetchFlightPlan(flightIdOrIcao) {
  try {
    const username = process.env.SIMBRIEF_USERNAME;
    const apiKey = process.env.SIMBRIEF_API_KEY;
    if (!username || !apiKey) {
      throw new Error("SIMBRIEF_USERNAME / SIMBRIEF_API_KEY no definidas en env");
    }
    const params = new URLSearchParams();
    params.append("username", username);
    params.append("api_key", apiKey);
    params.append("flight_id", flightIdOrIcao);
    const url = `${SIMBRIEF_API_URL}?${params.toString()}`;
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/xml" }
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`SimBrief request failed: ${res.status} ${res.statusText} - ${txt}`);
    }
    const xml = await res.text();
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@",
      textNodeName: "#text",
      parseTagValue: true,
      trimValues: true
    });
    const json = parser.parse(xml);
    const info = extractFlightInfo(json);
    return info;
  } catch (err) {
    log.error({ err }, "Error fetching/parsing SimBrief");
    throw err;
  }
}

module.exports = { fetchFlightPlan, extractFlightInfo };