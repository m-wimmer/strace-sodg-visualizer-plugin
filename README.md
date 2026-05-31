# Plugin for perfetto to visualize SODGs with strace

git clone https://github.com/m-wimmer/strace-visualizer-plugin.git
docker build -t perfetto-strace-vis
docker run perfetto-strace-vis --publish:10000:10000
