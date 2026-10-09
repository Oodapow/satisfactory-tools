// Hash routes for the editor: "#/map" (factory map) and "#/map/<outpost id>" (floor plan).
export function editorPath(outpostId?: string) {
  return outpostId ? `#/map/${outpostId}` : '#/map'
}
