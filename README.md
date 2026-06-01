# Plugin for perfetto to visualize SODGs with strace

Clone this repository

```git clone https://github.com/m-wimmer/strace-visualizer-plugin.git```

Build the image that includes Perfetto and its modifications for the plugin to work. (This can take a lot of time and CPU)

```docker build -t perfetto-strace-vis```

Compose to start up the Perfetto instance together with a Neo4j instance. Add Csv files created from my [converter](https://github.com/m-wimmer/strace-converter-rs) by creating a folder named _import_ (or how you like, if you change it in the compose) before starting the setup.

```docker compose up```

