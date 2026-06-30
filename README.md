React JS -> ArcGIS Server
<img width="1907" height="917" alt="image" src="https://github.com/user-attachments/assets/f853dc80-7cdd-4593-ba92-91cf52d95b93" />


Instruction:
1) Clone the repo
2) Change the .env for api key for routing engine etc.
3) Edit ArcGISConfiguration.js WEBMAP_ID,WEBSCENE_ID, HEATMAP_FEATURE_LAYER_URL to your own.
4) docker compose up -- build


Implementation:
1) Displaying 2D and 3D Map layer from arcgis.
   <img width="1080" height="730" alt="image" src="https://github.com/user-attachments/assets/0f7244f2-4861-4a26-a27c-a61178650329" />
   <img width="1907" height="805" alt="image" src="https://github.com/user-attachments/assets/58f377ea-b41d-461a-b228-e4965e70479e" />
2) Routing engine using ArcGIS Network analyst and implemented geocode service using arcgis SDK now using building name.
<img width="1647" height="905" alt="image" src="https://github.com/user-attachments/assets/4d02617b-0fb0-442b-885b-65961a87d06b" />
<img width="1002" height="940" alt="image" src="https://github.com/user-attachments/assets/f523d381-2190-4058-8ac0-dbb5a6a3a0a4" />
<img width="1917" height="746" alt="image" src="https://github.com/user-attachments/assets/6cf6e234-b9c4-4b7d-a743-7efe08f3775e" />

3) Implemented toggle on off for heat map and routing, routing start and end point, intensity bar for heatmap
   <img width="1071" height="942" alt="image" src="https://github.com/user-attachments/assets/78471920-8c72-4f6e-82d9-a9129f6d1a6a" />
   <img width="1035" height="896" alt="image" src="https://github.com/user-attachments/assets/9b0f958f-84ec-4431-8da9-a27fef1cbdfa" />
   <img width="1457" height="785" alt="image" src="https://github.com/user-attachments/assets/8289b341-39d4-4181-8a3e-307333ae691f" />

4) Reskined the UI
   <img width="1906" height="936" alt="image" src="https://github.com/user-attachments/assets/70ecba05-1010-4a48-902d-87f5ef1d0bc0" />
   <img width="1896" height="892" alt="image" src="https://github.com/user-attachments/assets/c7c83f6d-5c9e-43c2-9b28-60fe64404d1f" />
5) Full UI Rework to toggle between layer view
   <img width="1907" height="917" alt="image" src="https://github.com/user-attachments/assets/f853dc80-7cdd-4593-ba92-91cf52d95b93" />
   <img width="1902" height="931" alt="image" src="https://github.com/user-attachments/assets/97a3ad65-1d73-4cec-bb16-4c245518af20" />
   <img width="1892" height="910" alt="image" src="https://github.com/user-attachments/assets/6364b2bb-614f-4d3f-a384-0385a3dc0c20" />
   <img width="1912" height="852" alt="image" src="https://github.com/user-attachments/assets/53a68111-4838-4628-abc3-335bd0c627a1" />






If using ArcGIS Enterprise:
Remember to switch the ROUTE_SERVICE_URL and GEO_CODER_URL to arcgis enterprise's url
