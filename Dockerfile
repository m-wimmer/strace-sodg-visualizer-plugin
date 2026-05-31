FROM node:26.2.0-bookworm

RUN apt update && apt install -y git curl python3 python3-venv && \ 
    git clone https://github.com/google/perfetto.git 

WORKDIR /perfetto
RUN git checkout c1bbc165292877349b219a12498c1e768015a9e8 && tools/install-build-deps --ui

WORKDIR ./ui
RUN ./pnpm add neo4j-driver@^6.0.1 && sed -i "/'connect-src': \[/a\  'http://127.0.0.1:7687', // strace-visualizer-plugin neo4j connection'" src/frontend/index.ts

WORKDIR /perfetto
COPY ./src ui/src/plugins/dev.strace.nodelink
RUN tools/install-build-deps --ui && ui/build

WORKDIR ui
CMD npm start
