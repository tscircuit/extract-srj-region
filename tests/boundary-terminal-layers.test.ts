import { expect, test } from "bun:test"
import type { SimpleRouteJson } from "@tscircuit/capacity-autorouter"
import { extractSrjRegion } from "../lib"

const createCrossings = (
  layers: string[],
  atomic = false,
): SimpleRouteJson => ({
  layerCount: 4,
  minTraceWidth: 0.2,
  bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 },
  obstacles: [],
  connections: layers.map((layer, i) => ({
    name: `net_${i}`,
    pointsToConnect: [
      { x: -2, y: 0, layer },
      { x: 2, y: 0, layer },
    ],
  })),
  traces: layers.map((layer, i) => ({
    type: "pcb_trace",
    pcb_trace_id: `trace_${i}`,
    connection_name: `net_${i}`,
    route: atomic
      ? [
          {
            route_type: "through_obstacle",
            start: { x: -2, y: 0 },
            end: { x: 2, y: 0 },
            from_layer: layer,
            to_layer: layer,
            width: 0.2,
          },
        ]
      : [
          { route_type: "wire", x: -2, y: 0, layer, width: 0.2 },
          { route_type: "wire", x: 2, y: 0, layer, width: 0.2 },
        ],
  })),
})

test("only suppresses boundary obstacles that share the cut terminal's layer", () => {
  const input = createCrossings(["top"])
  input.obstacles = [
    ["top"],
    ["bottom"],
    ["inner1", "inner2"],
    ["top", "bottom"],
  ].map((layers, i) => ({
    obstacleId: `pad_${i}`,
    type: "rect",
    layers,
    center: { x: -1.1, y: 0 },
    width: 0.4,
    height: 0.4,
    connectedTo: ["other_net"],
  }))
  const original = structuredClone(input)
  const result = extractSrjRegion(
    input,
    { minX: -1, maxX: 1, minY: -1, maxY: 1 },
    { protectedBounds: { minX: -0.75, maxX: 0.75, minY: -0.75, maxY: 0.75 } },
  )
  expect(
    result.obstacles
      .filter((obstacle) => obstacle.obstacleId?.startsWith("pad_"))
      .map((obstacle) => obstacle.obstacleId),
  ).toEqual(["pad_1", "pad_2"])
  expect(input).toEqual(original)
})

test.each([
  ["top", "bottom"],
  ["inner1", "inner2"],
])(
  "does not shift overlapping boundary terminals on %s and %s",
  (firstLayer, secondLayer) => {
    const layers = [firstLayer, secondLayer]
    const input = createCrossings(layers)
    const original = structuredClone(input)
    const result = extractSrjRegion(input, {
      minX: -1,
      maxX: 1,
      minY: -1,
      maxY: 1,
    })
    for (const [i, connection] of result.connections.entries()) {
      expect(connection.pointsToConnect).toMatchObject([
        { x: -1, y: 0, layer: layers[i] },
        { x: 1, y: 0, layer: layers[i] },
      ])
      expect(connection.__rootConnectionNames).toEqual([`net_${i}`])
      expect(result.traces?.[i]?.route).toHaveLength(2)
    }
    expect(input).toEqual(original)
  },
)

test("extracts overlapping traces on separate layers when the crop has no room for stubs", () => {
  const result = extractSrjRegion(createCrossings(["top", "bottom"]), {
    minX: -1,
    maxX: 1,
    minY: -0.05,
    maxY: 0.05,
  })
  expect(result.connections).toHaveLength(2)
  expect(result.obstacles.map((obstacle) => obstacle.layers)).toEqual([
    ["top"],
    ["top"],
    ["bottom"],
    ["bottom"],
  ])
})

test("retains coincident atomic crossings on separate layers", () => {
  const input = createCrossings(["top", "bottom"], true)
  const result = extractSrjRegion(input, {
    minX: -1,
    maxX: 1,
    minY: -1,
    maxY: 1,
  })
  expect(result.connections).toHaveLength(2)
  expect(result.traces?.map((trace) => trace.route)).toEqual(
    input.traces?.map((trace) => trace.route),
  )
})

test("still rejects coincident atomic crossings of different nets on the same layer", () => {
  expect(() =>
    extractSrjRegion(createCrossings(["top", "top"], true), {
      minX: -1,
      maxX: 1,
      minY: -1,
      maxY: 1,
    }),
  ).toThrow("Could not allocate a distinct boundary terminal")
})
