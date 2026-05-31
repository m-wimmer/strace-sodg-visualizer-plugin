FROM ubuntu:24.04
RUN apt update && apt install -y git curl python3 python3-venv
RUN git clone https://github.com/google/perfetto.git
WORKDIR perfetto
RUN git checkout c1bbc165292877349b219a12498c1e768015a9e8 && tools/install-build-deps --ui 

CMD ui/run-dev-server
