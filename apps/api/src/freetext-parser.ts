// V3-OBS-61: deterministic (LLM 既定OFF・不変条項①) freetext observation
// parser. A single free-text line/paragraph → structured JSON: 日付・個体・
// 温度・湿度・胸角・エサ. Pure regex extraction, no external calls — this is
// the "最小観測入力UI" parser itself; wiring the parsed fields into an actual
// R2 commit is a separate, later step (obs-entry's existing fields already
// cover that; this endpoint only proposes a JSON reading of the free text).
//
// ponytail: fixed keyword vocabulary (個体/温度or℃/湿度/胸角/エサ). Add more
// item keywords here if real usage shows other common row patterns — this is
// intentionally not a general NLU model.
export interface ParsedMeasurement {
  item: "temperature" | "humidity" | "horn_length";
  value: number;
  unit: string;
}

export interface ParsedObservationFreetext {
  date: string | null;
  individual_id: string | null;
  measurements: ParsedMeasurement[];
  food: string | null;
  matched: boolean;
}

const DATE_RE = /(\d{4})[-\/年](\d{1,2})[-\/月](\d{1,2})日?/;
const INDIVIDUAL_RE = /個体(?:ID)?[:：]?\s*([A-Za-z0-9_-]+)/;
const TEMPERATURE_RE = /([\d.]+)\s*(?:℃|度C|度)/;
const HUMIDITY_RE = /湿度[:：]?\s*([\d.]+)\s*%/;
const HORN_RE = /胸角[:：]?\s*([\d.]+)\s*mm/;
const FOOD_RE = /エサ[:：]?\s*([^\s、,。]+)/;

/** Parse one observation freetext row into structured fields (all optional). */
export function parseObservationFreetext(text: string): ParsedObservationFreetext {
  const dateMatch = text.match(DATE_RE);
  const date = dateMatch
    ? `${dateMatch[1]}-${dateMatch[2].padStart(2, "0")}-${dateMatch[3].padStart(2, "0")}`
    : null;

  const individualMatch = text.match(INDIVIDUAL_RE);
  const individual_id = individualMatch ? individualMatch[1] : null;

  const measurements: ParsedMeasurement[] = [];
  const tempMatch = text.match(TEMPERATURE_RE);
  if (tempMatch) measurements.push({ item: "temperature", value: Number(tempMatch[1]), unit: "℃" });
  const humidityMatch = text.match(HUMIDITY_RE);
  if (humidityMatch) measurements.push({ item: "humidity", value: Number(humidityMatch[1]), unit: "%" });
  const hornMatch = text.match(HORN_RE);
  if (hornMatch) measurements.push({ item: "horn_length", value: Number(hornMatch[1]), unit: "mm" });

  const foodMatch = text.match(FOOD_RE);
  const food = foodMatch ? foodMatch[1] : null;

  const matched = date != null || individual_id != null || measurements.length > 0 || food != null;
  return { date, individual_id, measurements, food, matched };
}
