React JS -> ArcGIS Server

Instruction:
1) Clone the repo
2) Change the .env for api key for routing engine etc.
3) edit arcgis config for portal address and routing service url
4) change app.jsx map / scene id to your own.
5) docker compose up -- build


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




