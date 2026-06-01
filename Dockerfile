FROM node:26.2.0-bookworm

RUN apt update && apt install -y git curl python3 python3-venv && \ 
    git clone https://github.com/google/perfetto.git 

# get perfetto release 53.0
WORKDIR /perfetto
RUN git checkout c1bbc165292877349b219a12498c1e768015a9e8 && tools/install-build-deps --ui

# add own dependency to ui project and relax csp 
WORKDIR ./ui
RUN ./pnpm add neo4j-driver@^6.0.1 && sed -i "/'connect-src': \[/a\  'http://127.0.0.1:7687', // strace-visualizer-plugin neo4j connection'" src/frontend/index.ts

# copy plugin to folder 
WORKDIR /perfetto
COPY ./src ui/src/plugins/dev.strace.nodelink

# update deps again and build application
RUN tools/install-build-deps --ui && ui/build

WORKDIR /perfetto/ui
CMD node build.js --serve-host 0.0.0.0 --serve
