import Graphic from "@arcgis/core/Graphic";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import { HEATMAP_FEATURE_LAYER_URL,MRT_STATION_FEATURE_LAYER_URL , MRT_LINE_FEATURE_LAYER_URL} from "../config/ArcGISConfiguration";
import SketchViewModel from "@arcgis/core/widgets/Sketch/SketchViewModel";
import shp from "shpjs";
import { saveAs } from "file-saver";

export default class GISMapEngine {
  constructor() {
    this.currentMap = null;
    this.routeLayer = null;
    this.stopLayer = null;
    this.heatLayer = null;
    this.routeGraphic = null;
    this.startGraphic = null;
    this.endGraphic = null;
    this.routeVisible = true;
    this.heatVisible = false;
    this.heatIntensity = 50;
    this.layerOrder = ["route", "stops", "touristAttractions", "heat", "mrtStations", "mrtLines", "drawings"];
    this.touristAttractionLayer = null;
    this.touristAttractionVisible = true;
    this.mrtStationLayer = null;
    this.mrtLineLayer = null;
    this.mrtStationVisible = true;
    this.mrtLineVisible = true;
    this.drawLayer = null;
    this.sketchVM = null;
  }

  attachToView(view) {
    if (!view) return;
    const map = view.map;

    this.currentMap = map;
    map.removeAll();
    this.routeLayer = new GraphicsLayer({
      title: "Route Layer",
      visible: this.routeVisible
    });

    this.stopLayer = new GraphicsLayer({
      title: "Stop Layer",
      visible: this.routeVisible
    });

    this.touristAttractionLayer = new FeatureLayer({
    url: HEATMAP_FEATURE_LAYER_URL,
    title: "Tourist Attractions",
    visible: this.touristAttractionVisible
  });

    this.mrtStationLayer = new FeatureLayer({
      url: MRT_STATION_FEATURE_LAYER_URL,
      title: "MRT Stations",
      visible: this.mrtStationVisible,
      renderer: {
        type: "simple",
        symbol: {
          type: "simple-fill",
          color: [0, 120, 255, 0.5],
          outline: {
            color: [0, 0, 0],
            width: 1.5
          }
        }
      }
    });

    this.mrtLineLayer = new FeatureLayer({
      url: MRT_LINE_FEATURE_LAYER_URL,
      title: "MRT Lines",
      visible: this.mrtLineVisible,
      renderer: {
        type: "simple",
         symbol: {
          type: "simple-line",
          color: [0, 0, 0],
          width: 1
        }
      }
    });
    
    this.drawLayer = new GraphicsLayer({
    title: "Drawings"
    });

    this.sketchVM = new SketchViewModel({
    view: view,
    layer: this.drawLayer
    });

    if (this.routeGraphic) this.routeLayer.add(this.routeGraphic);
    if (this.startGraphic) this.stopLayer.add(this.startGraphic);
    if (this.endGraphic) this.stopLayer.add(this.endGraphic);

    this.heatLayer = new FeatureLayer({
      url: HEATMAP_FEATURE_LAYER_URL,
      title: "Heat Layer",
      visible: this.heatVisible,
      opacity: 0.8,
      renderer: {
        type: "heatmap",
        radius: 25,
        colorStops: [
          { ratio: 0, color: "rgba(0,0,255,0)" },
          { ratio: 0.2, color: "blue" },
          { ratio: 0.4, color: "cyan" },
          { ratio: 0.6, color: "lime" },
          { ratio: 0.8, color: "yellow" },
          { ratio: 1, color: "red" }
        ],
        maxPixelIntensity: this.heatIntensity,
        minPixelIntensity: 1
      }
    });

    const layerMap = {
      route: this.routeLayer,
      stops: this.stopLayer,
      touristAttractions: this.touristAttractionLayer,
      heat: this.heatLayer,
      mrtStations: this.mrtStationLayer,
      mrtLines: this.mrtLineLayer,
      drawings: this.drawLayer
    };

    this.layerOrder.forEach((id) => {
      const layer = layerMap[id];
      if (layer) map.add(layer);
      this.sketchVM = new SketchViewModel({
        view: view,
        layer: this.drawLayer
        });
    });
  }

  drawRoute(routeGeometry) {
    this.routeGraphic = new Graphic({
      geometry: routeGeometry,
      symbol: {
        type: "simple-line",
        color: [0, 0, 0],
        width: 10
      }
    });

    if (!this.routeLayer) return;
    this.routeLayer.removeAll();
    this.routeLayer.add(this.routeGraphic);
  }

  drawStops(start, end) {
    this.startGraphic = new Graphic({
      geometry: start,
      symbol: {
        type: "simple-marker",
        color: "green",
        size: 10
      }
    });

    this.endGraphic = new Graphic({
      geometry: end,
      symbol: {
        type: "simple-marker",
        color: "red",
        size: 10
      }
    });

    if (!this.stopLayer) return;
    this.stopLayer.removeAll();
    this.stopLayer.addMany([this.startGraphic, this.endGraphic]);
  }

  toggleRoute(visible) {
    this.routeVisible = visible;

    if (this.routeLayer) this.routeLayer.visible = visible;
    if (this.stopLayer) this.stopLayer.visible = visible;
  }

  enableHeatmap(view, intensity) {
    this.heatVisible = true;
    this.heatIntensity = intensity;

    if (!this.heatLayer) return;

    this.heatLayer.visible = true;

    const renderer = this.heatLayer.renderer.clone();
    renderer.maxPixelIntensity = intensity;
    this.heatLayer.renderer = renderer;
  }

  disableHeatmap() {
    this.heatVisible = false;

    if (this.heatLayer) this.heatLayer.visible = false;
  }

  updateHeatmapIntensity(value) {
    this.heatIntensity = value;

    if (!this.heatLayer) return;

    const renderer = this.heatLayer.renderer.clone();
    renderer.maxPixelIntensity = value;
    this.heatLayer.renderer = renderer;
  }

  getLayers() {
    const lookup = {
      route: {
        id: "route",
        name: "Route Layer",
        visible: this.routeLayer?.visible ?? true
      },
      stops: {
        id: "stops",
        name: "Stop Layer",
        visible: this.stopLayer?.visible ?? true
      },
      touristAttractions: {
        id: "touristAttractions",
        name: "Tourist Attractions Layer",
        visible: this.touristAttractionLayer?.visible ?? true
      },
      heat: {
        id: "heat",
        name: "Tourist Attractions Heatmap Layer",
        visible: this.heatLayer?.visible ?? false
      },
      mrtStations: {
        id: "mrtStations",
        name: "MRT Stations Layer",
        visible: this.mrtStationLayer?.visible ?? true
      },
      mrtLines: {
        id: "mrtLines",
        name: "MRT Lines Layer",
        visible: this.mrtLineLayer?.visible ?? true
      },
      drawings: {
        id: "drawings",
        name: "Drawings Layer",
        visible: this.drawLayer?.visible ?? true
      }
    };

    return this.layerOrder.map((id) => lookup[id]);
  }

  toggleLayer(id) {
    const layerMap = {
      route: this.routeLayer,
      stops: this.stopLayer,
      touristAttractions: this.touristAttractionLayer,
      heat: this.heatLayer,
      mrtStations: this.mrtStationLayer,
      mrtLines: this.mrtLineLayer,
      drawings: this.drawLayer
    };

    const layer = layerMap[id];
    if (layer) layer.visible = !layer.visible;
  }

  reorderLayers(fromIndex, toIndex) {
    const order = [...this.layerOrder];

    const moved = order.splice(fromIndex, 1)[0];
    order.splice(toIndex, 0, moved);

    this.layerOrder = order;

    if (!this.currentMap) return;

    const layerMap = {
      route: this.routeLayer,
      stops: this.stopLayer,
      heat: this.heatLayer,
      touristAttractions: this.touristAttractionLayer,
      mrtStations: this.mrtStationLayer,
      mrtLines: this.mrtLineLayer,
      drawings: this.drawLayer
    };

    order.forEach((id, index) => {
      const layer = layerMap[id];
      if (layer) this.currentMap.reorder(layer, index);
    });
  }
  startPointDraw() {
  if (!this.sketchVM) return;
  this.sketchVM.create("point");
  }

  startLineDraw() {
  if (!this.sketchVM) return;
  this.sketchVM.create("polyline");
  }

  startPolygonDraw() {
  if (!this.sketchVM) return;
  this.sketchVM.create("polygon");
  }

  getDrawnFeatures(){
  const f=[];

  if(this.drawLayer){
    f.push(...this.drawLayer.graphics.toArray());
  }

  if(this.routeGraphic)f.push(this.routeGraphic);
  if(this.startGraphic)f.push(this.startGraphic);
  if(this.endGraphic)f.push(this.endGraphic);

  return f;
}

hasDrawings(){
  return this.getDrawnFeatures().length>0;
}

saveDrawings(msg){
  const f=this.getDrawnFeatures();
  if(!f.length)return msg?.("No drawings to export");
  const geojson={
    type:"FeatureCollection",
    features:f.map(x=>({
      type:"Feature",
      geometry:this.toGeoJSONGeometry(x.geometry),
      properties:{}
    }))
  };
  const url=URL.createObjectURL(
    new Blob([JSON.stringify(geojson)],{type:"application/json"})
  );
  const a=document.createElement("a");
  a.href=url;
  a.download="drawings.geojson";
  a.click();
  URL.revokeObjectURL(url);
  msg?.("GeoJSON downloaded");
}

toGeoJSONGeometry(g){
  if(!g) return null;
  const t=g.type;
  if(t==="point"){
    return {
      type:"Point",
      coordinates:[g.x,g.y] 
    };
  }
  if(t==="polyline"){
    return {
      type:"LineString",
      coordinates:g.paths?.[0] || []
    };
  }
  if(t==="polygon"){
    return {
      type:"Polygon",
      coordinates:g.rings || []
    };
  }
  return null;
}

saveDrawingsAsGEOJSON(msg){
  const f=this.getDrawnFeatures();
  if(!f.length){
    msg?.("Unable to download: no drawings found");
    setTimeout(()=>msg?.(""),10000);
    return;
  }
  const geojson={
    type:"FeatureCollection",
    features:f.map(x=>({
      type:"Feature",
      geometry:this.toGeoJSONGeometry(x.geometry),
      properties:{}
    }))
  };
  const blob=new Blob([JSON.stringify(geojson,null,2)],{
    type:"application/json"
  });
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;
  a.download="drawings.geojson";
  a.click();
  URL.revokeObjectURL(url);
}
}