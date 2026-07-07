import { render } from "@testing-library/react";
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

  test("renders an arcgis-scene with the web scene id when is3D is true", () => {
    const { container } = render(
      <GISMapView is3D={true} webMapId="map-123" webSceneId="scene-456" onViewReady={jest.fn()} />
    );

    const sceneEl = container.querySelector("arcgis-scene");
    expect(sceneEl).not.toBeNull();
    expect(sceneEl.getAttribute("item-id")).toBe("scene-456");
    expect(container.querySelector("arcgis-map")).toBeNull();
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
