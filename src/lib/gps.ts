export interface TrackPoint {
  lat: number
  lng: number
  ele?: number
  ts?: number   // unix ms
}

export interface TrackSummary {
  points: TrackPoint[]
  distanceM: number
  durationS: number
  avgSpeedKmh: number
  maxSpeedKmh: number
  elevationGainM: number
  startTime?: Date
}

function haversineM(a: TrackPoint, b: TrackPoint): number {
  const R = 6371000
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const sinLat = Math.sin(dLat / 2)
  const sinLng = Math.sin(dLng / 2)
  const c = sinLat * sinLat + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * sinLng * sinLng
  return R * 2 * Math.atan2(Math.sqrt(c), Math.sqrt(1 - c))
}

function parseGpx(text: string): TrackPoint[] {
  const points: TrackPoint[] = []
  const trkptRe = /<trkpt\s[^>]*lat="([^"]+)"[^>]*lon="([^"]+)"[^>]*>([\s\S]*?)<\/trkpt>/g
  let m: RegExpExecArray | null
  while ((m = trkptRe.exec(text)) !== null) {
    const lat = parseFloat(m[1])
    const lng = parseFloat(m[2])
    const inner = m[3]
    const eleM = /<ele>([\d.]+)<\/ele>/.exec(inner)
    const timeM = /<time>([^<]+)<\/time>/.exec(inner)
    if (!isNaN(lat) && !isNaN(lng)) {
      points.push({
        lat,
        lng,
        ele: eleM ? parseFloat(eleM[1]) : undefined,
        ts: timeM ? new Date(timeM[1]).getTime() : undefined,
      })
    }
  }
  return points
}

function parseCsv(text: string): TrackPoint[] {
  const lines = text.trim().split(/\r?\n/)
  const header = lines[0].toLowerCase().split(/[,;\t]/)
  const latIdx = header.findIndex(h => h.includes("lat"))
  const lngIdx = header.findIndex(h => h.includes("lon") || h.includes("lng"))
  const eleIdx = header.findIndex(h => h.includes("ele") || h.includes("alt"))
  const tsIdx = header.findIndex(h => h.includes("time") || h.includes("date") || h.includes("ts"))
  if (latIdx < 0 || lngIdx < 0) return []
  const points: TrackPoint[] = []
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(/[,;\t]/)
    const lat = parseFloat(cols[latIdx])
    const lng = parseFloat(cols[lngIdx])
    if (!isNaN(lat) && !isNaN(lng)) {
      const raw = tsIdx >= 0 ? cols[tsIdx]?.trim() : undefined
      const ts = raw ? (isNaN(Number(raw)) ? new Date(raw).getTime() : Number(raw) * 1000) : undefined
      points.push({ lat, lng, ele: eleIdx >= 0 ? parseFloat(cols[eleIdx]) : undefined, ts })
    }
  }
  return points
}

export function parseTrackFile(filename: string, text: string): TrackPoint[] {
  const ext = filename.split(".").pop()?.toLowerCase()
  if (ext === "gpx") return parseGpx(text)
  if (ext === "csv") return parseCsv(text)
  // try GPX first, then CSV
  const gpx = parseGpx(text)
  return gpx.length > 0 ? gpx : parseCsv(text)
}

export function summarizeTrack(points: TrackPoint[]): TrackSummary {
  let distanceM = 0
  let elevationGainM = 0
  let maxSpeedKmh = 0

  for (let i = 1; i < points.length; i++) {
    const d = haversineM(points[i - 1], points[i])
    distanceM += d
    if (points[i].ele !== undefined && points[i - 1].ele !== undefined) {
      const dEle = points[i].ele! - points[i - 1].ele!
      if (dEle > 0) elevationGainM += dEle
    }
    if (points[i].ts && points[i - 1].ts) {
      const dt = (points[i].ts! - points[i - 1].ts!) / 1000
      if (dt > 0 && dt < 60) {
        const speedKmh = (d / dt) * 3.6
        if (speedKmh > maxSpeedKmh && speedKmh < 50) maxSpeedKmh = speedKmh
      }
    }
  }

  const first = points[0]?.ts
  const last = points[points.length - 1]?.ts
  const durationS = first && last ? (last - first) / 1000 : 0
  const avgSpeedKmh = durationS > 0 ? (distanceM / durationS) * 3.6 : 0

  return {
    points,
    distanceM,
    durationS,
    avgSpeedKmh,
    maxSpeedKmh,
    elevationGainM,
    startTime: first ? new Date(first) : undefined,
  }
}
