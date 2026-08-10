import { render, screen, waitFor } from "@testing-library/react";
import GISMapView from "./GISMapView";

// jsdom doesn't register @arcgis/map-components' real custom elements (they're
// stubbed out in test/mocks), so React never turns onarcgisViewReadyChange
// into a DOM property/listener the way it would for a genuine custom element.
// Reading it off the fiber's captured props is the only way to exercise the
// handler that's actually wired up.
function getReactProps(node) {
  const key = Object.keys(node).find((k) => k.startsWith("__reactProps$"));
  return node[key];
}

describe("GISMapView", () => {
  test("renders an arcgis-map with the web map id when is3D is false", () => {
    const { container } = render(
      <GISMapView is3D={false} webMapId="map-123" webSceneId="scene-456" onViewReady={jest.fn()} />
    );

    const mapEl = container.querySelector("arcgis-map");
    expect(mapEl).not.toBeNull();
    expect(mapEl.getAttribute("item-id")).toBe("map-123");
    expect(container.querySelector("arcgis-scene")).toBeNull();
    expect(mapEl.querySelector("arcgis-zoom")).not.toBeNull();
  });

  // The arcgis-scene custom element is imported on demand rather than at
  // module scope, to keep the 3D renderer out of the entry chunk for the
  // (always 2D) first load - see GISMapView's own comment. So unlike the
  // arcgis-map case above, the element appears only once that import
  // resolves, and a placeholder stands in until it does.
  test("renders an arcgis-scene with the web scene id when is3D is true, once its component has loaded", async () => {
    const { container } = render(
      <GISMapView is3D={true} webMapId="map-123" webSceneId="scene-456" onViewReady={jest.fn()} />
    );

    await waitFor(() => expect(container.querySelector("arcgis-scene")).not.toBeNull());

    const sceneEl = container.querySelector("arcgis-scene");
    expect(sceneEl.getAttribute("item-id")).toBe("scene-456");
    expect(container.querySelector("arcgis-map")).toBeNull();
  });

  test("shows a placeholder instead of an un-upgraded element while the 3D component loads", async () => {
    const { container } = render(
      <GISMapView is3D={true} webMapId="map-123" webSceneId="scene-456" onViewReady={jest.fn()} />
    );

    expect(screen.getByRole("status")).toHaveTextContent("Loading 3D view…");
    expect(container.querySelector("arcgis-scene")).toBeNull();

    // Let the pending import settle inside the test, so its state update is
    // flushed here rather than escaping into the next test as an act warning.
    await waitFor(() => expect(container.querySelector("arcgis-scene")).not.toBeNull());
  });

  test("forwards the ready view through onViewReady when the custom element fires its event", () => {
    const onViewReady = jest.fn();
    const { container } = render(
      <GISMapView is3D={false} webMapId="map-123" webSceneId="scene-456" onViewReady={onViewReady} />
    );

    const view = { id: "fake-view" };
    const mapEl = container.querySelector("arcgis-map");
    getReactProps(mapEl).onarcgisViewReadyChange({ target: { view } });

    expect(onViewReady).toHaveBeenCalledWith(view);
  });

  test("does not throw when onViewReady is not provided", () => {
    expect(() =>
      render(<GISMapView is3D={false} webMapId="map-123" webSceneId="scene-456" />)
    ).not.toThrow();
  });
});
