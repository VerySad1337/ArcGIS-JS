Instruction:
1) Clone the repo
2) Change the .env for api key for routing engine etc.
3) edit arcgis config for portal address and routing service url
4) change app.jsx map / scene id to your own.
5) docker compose up -- build


Implementation:
1) Displaying 2D and 3D Map layer from arcgis.
2) Routing engine using ArcGIS Network analyst with lat / long.
3) Implemented geocode service using arcgis SDK now using postal code / building name.
