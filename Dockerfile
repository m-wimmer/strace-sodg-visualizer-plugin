FROM node:26.2.0-bookworm

RUN apt update && apt install -y git curl python3 python3-venv && \ 
    git clone https://github.com/google/perfetto.git 

WORKDIR /perfetto
RUN git checkout ff22e9c315215f85b53f851f0f72eac8463c538e && tools/install-build-deps --ui

# add own dependency to ui project and relax csp 
WORKDIR ./ui
RUN ./pnpm add neo4j-driver@^6.0.1 && sed -i "/'connect-src': \[/a\  'ws://*:7687', // strace-visualizer-plugin neo4j connection'" src/frontend/index.ts

# copy plugin to folder 
WORKDIR /perfetto
COPY ./src ui/src/plugins/dev.strace.nodelink

# update deps again and build application
RUN tools/install-build-deps --ui && ui/build

WORKDIR /perfetto/ui
CMD ./node ./build.js --serve-host 0.0.0.0 --serve --only-wasm-memory64
