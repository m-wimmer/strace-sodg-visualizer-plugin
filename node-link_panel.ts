

import m from 'mithril';
import {Trace} from '../../public/trace';
import { TimeSpan } from 'src/base/time';
import { Driver ,Record} from 'neo4j-driver';
import * as d3 from 'd3';
import { Button } from '../../widgets/button';
import { TrackNode } from 'src/public/workspace';
import {graphConfig} from "./constants";

export interface NodeLinkPanelAttrs {
    readonly trace: Trace;
    readonly driver: Driver;
}

// different queries are executed for each different selected graph
enum GraphSelection{
    Basic,
    Detailed,
    Granular,
}

interface Nodes_t extends d3.SimulationNodeDatum { id: number; label: string; type: string; color: string};
interface Links_t extends d3.SimulationLinkDatum<Nodes_t> {source:number; target: number; type:string; color: string; syscall:string};

export class NodeLinkPanel implements m.ClassComponent<NodeLinkPanelAttrs> {

    private readonly trace: Trace;
    private graph: SVGSVGElement | null = null; // idk

    constructor({attrs}: m.CVnode<NodeLinkPanelAttrs>) {
        this.trace = attrs.trace;
        void this.trace; // suppress not used error
    }


    view(vnode: m.Vnode<NodeLinkPanelAttrs, this>): m.Children | null | void {
        const visibleSpan = vnode.attrs.trace.selection.getTimeSpanOfSelection();
        if(visibleSpan === undefined) return;
        const driver = vnode.attrs.driver;
        console.log("view");
        return m('node-link-graph', [
            m(Button, {
                label: 'Basic graph',
                onclick: () => {
                    this.queryNeo4j(driver,vnode.attrs.trace.workspaces.currentWorkspace.pinnedTracks,visibleSpan,GraphSelection.Basic).then(() => {
                        m.redraw();
                    });

                },
            }),
            m(Button, {
                label: 'Aggregated by System call (One relation for each unique System call)',
                onclick: () => {
                    this.queryNeo4j(driver,vnode.attrs.trace.workspaces.currentWorkspace.pinnedTracks,visibleSpan,GraphSelection.Detailed).then(() => {
                        m.redraw();
                    });

                },
            }),
            m(Button, {
                label: 'Granular graph (All system calls without aggregation)',
                onclick: () => {
                    this.queryNeo4j(driver,vnode.attrs.trace.workspaces.currentWorkspace.pinnedTracks,visibleSpan,GraphSelection.Granular).then(() => {
                        m.redraw();
                    });

                },
            }),
            m('div',`Time range for graph generation: ${visibleSpan.start} to ${visibleSpan.end}`),

            m('div',{ oncreate: vnode => {
                if(this.graph){
                    vnode.dom.innerHTML = '';
                    vnode.dom.appendChild(this.graph);
                }
            },
            onupdate: vnode => {
                vnode.dom.innerHTML = '';
                if (this.graph) vnode.dom.appendChild(this.graph);
            },
            id:'test',
            }),
        ]);

    }



    oncreate({attrs}: m.VnodeDOM<NodeLinkPanelAttrs, this>) {
        void attrs;
        console.log("create");
    }

    private async queryNeo4j(driver: Driver, pinnedTracks: readonly TrackNode[],timespan: TimeSpan, graphType: number){ //query db, call functions to generate graph

        const startTimeInt = BigInt(timespan.start) / 1000n; // rounds timestamps down
        const endTimeInt = BigInt(timespan.end) / 1000n;
        const pinned_track_names = pinnedTracks.map( track => track.name.replace("Thread ",""));

        let track_filter = "";

        // adjust queries based on the pinned tracks
        if (pinned_track_names.length > 0){
            track_filter += "AND ( ";
            pinned_track_names.forEach(
                (track,index) => {
                    if (index == pinned_track_names.length - 1){
                        track_filter = track_filter + `a.name =~ '${track}.*' OR b.name =~ '${track}.*'`
                    }else{
                        track_filter = track_filter + `a.name =~ '${track}.*' OR b.name =~ '${track}.*' OR `
                    }
                }
            )
            track_filter += ")";
        }



        if (graphType == GraphSelection.Basic) {

            // query that returns only one relation between nodes
            const {records} = await driver.executeQuery(
                `
                MATCH (a)-[r:SYSCALL]->(b)
                WHERE r.ts >= ${startTimeInt} AND r.ts <= ${endTimeInt} ${track_filter}
                WITH a,b,
                (count(r) - sum(toInteger(r.successful)) )  AS failureCount,
                collect(r)[0] AS rels, 
                count(r) as relCount
                RETURN a,rels,b, CASE failureCount
                WHEN 0 THEN 1
                WHEN relCount THEN 0
                WHEN > 0 THEN -1
                ELSE -2
                    END as successState
                `,{},{}
            );
            const {nodes,links} = await this.convertToD3(records,graphType);
            this.graph = await this.generateGraph(nodes,links);

        }
        else if (graphType == GraphSelection.Detailed) {

            // query that returns a relation per unique system call between nodes
            const {records} = await driver.executeQuery(
                `
                MATCH (a)-[r:SYSCALL]->(b)
                WHERE r.ts >= ${startTimeInt} AND r.ts <= ${endTimeInt} ${track_filter}
                WITH a,b,r.syscall AS syscallname,
                (count(r) - sum(toInteger(r.successful)) )  AS failureCount,
                collect(r)[0] AS rels, 
                count(r) as relCount
                RETURN a,syscallname,rels,b, CASE failureCount
                WHEN 0 THEN 1
                WHEN relCount THEN 0
                WHEN > 0 THEN -1
                ELSE -2
                    END as successState
                `,{},{}
            );
            const {nodes,links} = await this.convertToD3(records,graphType);
            this.graph = await this.generateGraph(nodes,links);

        }
        else if (graphType == GraphSelection.Granular) {

            // query that returns a relation per system call between nodes
            const {records} = await driver.executeQuery(
                `
                MATCH (a)-[r:SYSCALL]->(b)
                WHERE r.ts >= ${startTimeInt} AND r.ts <= ${endTimeInt} ${track_filter}
                WITH a,b,r as rels,
                (count(r) - sum(toInteger(r.successful)) )  AS failureCount, 
                count(r) as relCount
                RETURN a,rels,b, CASE failureCount
                WHEN 0 THEN 1
                WHEN relCount THEN 0
                WHEN > 0 THEN -1
                ELSE -2
                    END as successState
                `,{},{}
            );
            const {nodes,links} = await this.convertToD3(records,graphType);
            this.graph = await this.generateGraph(nodes,links);

        }
        else {
            console.log("unhandled graph generation");
        }



        return this.graph;

    }
    // converts the queried data into node and edge objects
    private async convertToD3(records: Record[],graphType: GraphSelection){

        // console.log(records);
        const nodes: Nodes_t[] =[];
        const links: Links_t[] = [];
        const nodeMap = new Map<string,boolean>();

        records.forEach(record =>{
            const aNode = record.get('a');
            const bNode = record.get('b');
            const rel = record.get('rels');
            const succ_count:number = record.get('successState');
            let rel_color = "grey";
            rel_color = this.selectColor(succ_count);
            let systemCall = rel.properties.syscall;


            const aID = aNode.identity.toString();
            const bID = bNode.identity.toString();

            if(!nodeMap.has(aID)){
                nodes.push({id:aID, label: aNode.properties.name, type:aNode.properties.type, color:this.selectColor_nodes(aNode.properties.type) || aID})
                nodeMap.set(aID,true);

            }
            if(!nodeMap.has(bID)){
                nodes.push({id:bID, label: bNode.properties.name, type: bNode.properties.type, color:this.selectColor_nodes(bNode.properties.type) || bID})
                nodeMap.set(bID,true);
            }
            // to make basic graphs display SYSCALL instead of the first relationship neo4j provides
            if (graphType == GraphSelection.Basic){
                systemCall = rel.type;
            }

            links.push({
                source: aID,
                target: bID,
                type: rel.type,
                color: rel_color,
                syscall: systemCall
            });

        })

        // METRIC: amount of nodes and edges to be visualized
        console.log("Number of nodes: " + nodes.length)
        console.log("Number of links: " + links.length)
        return {nodes,links}

    }

    private async generateGraph(nodeList: Nodes_t[],relList:any[]){

        const data  = {nodeList, relList};

        // The force simulation mutates links and nodes, so create a copy
        // so that re-evaluating cell produces the same result.
        var links = data.relList.map(d => ({...d}));
        const nodes = data.nodeList.map(d => ({...d}));

        const simulation = d3.forceSimulation(nodes)
        .force("link", d3.forceLink(links).distance(graphConfig.forceLinkDistanceForce)
               .id((d: any) => d.id))
                // https://stackoverflow.com/questions/63568907/why-do-i-get-an-error-on-simulationnodedatum-when-using-d3-on-angular-10-for-f
               .force("charge", d3.forceManyBody().strength(graphConfig.forceManyBody))
               .force("center", d3.forceCenter(graphConfig.forceCenterx, graphConfig.forceCentery))
               .force("collision",d3.forceCollide().radius(graphConfig.forceCollide))
               .alphaDecay(graphConfig.forceAlphaDecay) // graph not as jittery

               for(let i=0;i<50;i++)simulation.tick();

               // Create the SVG container.
               const svg = d3.create("svg")
               .attr("viewBox", [-graphConfig.svgBoxWidth / 2, -graphConfig.svgBoxHeight / 2, graphConfig.svgBoxWidth, graphConfig.svgBoxHeight])
               .attr("width", graphConfig.svgBoxWidth)
               .attr("height", graphConfig.svgBoxHeight)
               .attr("style", "max-width: 100%; height: auto; font: 12px sans-serif;");


               const zoomLayer = svg.append("g");

               // multlink setup adjusted https://github.com/zhanghuancs/D3.js-Node-MultiLinks-Node

                   // let mLinkNum: {[key:string]:number}= {};
                   let linkMap = new Map<string,number>();

                  // sort links (added id so we sort based on integers and not based on objects)
                   links.sort(function(a,b) {
                       if (a.source.id > b.source.id) { return 1; }
                       else if (a.source.id < b.source.id) { return -1; }
                       else {
                           if (a.target.id > b.target.id) { return 1; }
                           if (a.target.id < b.target.id) { return -1; }
                           else { return 0; }
                       }
                   });

                   for (var i = 0; i < links.length; i++) 
                   {
                       if (i != 0 &&
                           links[i].source.id == links[i-1].source.id &&
                               links[i].target.id == links[i-1].target.id) 
                           { links[i].linkindex = links[i-1].linkindex + 1; }
                       else { links[i].linkindex = 1; }
                       
                       // save the total number of linkes between two nodes
                       if(linkMap.get(links[i].target.id + "," + links[i].source.id) !== undefined) {
                           linkMap.set(links[i].target.id + "," + links[i].source.id,links[i].linkindex);
                       }
                       else {
                           linkMap.set(links[i].source.id + "," + links[i].target.id,links[i].linkindex);
                       }
                   }

               // multlink setup adjusted https://github.com/zhanghuancs/D3.js-Node-MultiLinks-Node

               //  link labels adjusted from https://observablehq.com/@xianwu/force-directed-graph-network-graph-with-arrowheads-and-lab
               const link = zoomLayer.selectAll(".links")
               .data(links)
               .join("path")
               .attr("class","links")
               .attr("fill","none")
               .attr("marker-end","url(#arrowhead)");

               const edgepaths = zoomLayer.selectAll(".edgepath")
               .data(links)
               .join("path")
               .attr("class","edgepath")
               .attr("stroke-opacity",graphConfig.linkStrokeOpacity)
               .attr("stroke-width",graphConfig.linkStrokeWidth)
               .attr("id",function (_d,i) {return 'edgepath' + i})
               .style("pointer-events", "none")
               .attr("fill","none")
               .attr("stroke",d => d.color);

               const edgelabels = zoomLayer.selectAll(".edgelabel")
               .data(links)
               .join("text")
               .style("pointer-events", "none")
               .attr("class","edgelabel")
               .attr("id", function(_d,i){return 'edgelabel'+i})
               .attr("font-size",graphConfig.linkLabelFontSize);


               edgelabels.append('textPath')
               .attr('xlink:href', function (_d, i) {return '#edgepath' + i})
               .style("text-anchor","middle")
               .style("pointer-events", "none")
               .attr("startOffset","50%")
               .attr("fill","white")
               .text(d => d.syscall);
               //  adjusted from https://observablehq.com/@xianwu/force-directed-graph-network-graph-with-arrowheads-and-lab


               const node = zoomLayer.append("g")
               .attr("stroke-linecap", graphConfig.nodeStrokeLinecap)
               .attr("stroke-linejoin", graphConfig.nodeStrokeLinejoin)
               .selectAll("g")
               .data(nodes)
               .join("g");
               // make circles
               node.append("circle")
               .attr("stroke", d => d.color)
               .attr("stroke-width", graphConfig.nodeCircleStrokeWidth)
               .attr("r", graphConfig.nodeCircleRadius)
               .attr("fill", d => d.color);
               // add text of node
               node.append("text")
               .attr("cy", graphConfig.nodeTextPosY)
               .text(d => d.label)
               .style("fill", graphConfig.nodeTextFill);
               node.append("title")
               .attr("cy", graphConfig.nodeTitlePosY)
               .text(d => d.label)
               .style("fill", graphConfig.nodeTitleFill);

               // https://observablehq.com/@john-guerra/force-directed-graph-with-link-highlighting
               node.on("mouseenter", (_evt:any, d:any) => {
                   edgepaths 
                   .attr("display", "none")
                   .filter(l => l.source.id === d.id || l.target.id === d.id)
                   .raise()
                   .attr("stroke-width",graphConfig.linkStrokeWidth +3)
                   .attr("display", "block");
                   edgelabels 
                   .attr("display", "none")
                   .filter(l => l.source.id === d.id || l.target.id === d.id)
                   .attr("font-size",graphConfig.linkLabelFontSize+4)
                   .raise()
                   .attr("display", "block");
               })
               .on("mouseleave", _evt => {
                   edgepaths 
                   .lower()
                   .attr("stroke-width",graphConfig.linkStrokeWidth)
                   .attr("display", "block");
                   edgelabels 
                   .lower()
                   .attr("font-size",graphConfig.linkLabelFontSize)
                   .attr("display", "block");
               });

               // https://observablehq.com/d/0a9d8ddacd2ec675
               // https://stackoverflow.com/questions/68893463/how-to-properly-type-zoom-on-d3-svg-with-typescript
               if(svg){
                   const zoomBehavior = d3.zoom<SVGSVGElement, undefined>()
                   .scaleExtent([0.1, 5])
                   .on("zoom", (event) => {
                       zoomLayer.attr("transform", event.transform);
                   }); 

                   svg.call(zoomBehavior).call(zoomBehavior.transform,d3.zoomIdentity);
               }

               // arc path formula adjusted from https://github.com/zhanghuancs/D3.js-Node-MultiLinks-Node

               function arcPath(d:any){
                   const dx = d.target.x - d.source.x;
                   const dy = d.target.y - d.source.y;
                   var TotalLinksBetweenNodes = linkMap.get(d.source.id + "," + d.target.id) || linkMap.get(d.target.id + "," + d.source.id);
                   if (TotalLinksBetweenNodes == undefined) TotalLinksBetweenNodes = 1;
                   // arcs alternate if there is more than one link. if there is only one then a straight path is drawn
                   if(TotalLinksBetweenNodes > 1){
                       if(d.linkindex % 2 == 1){
                           let dr = (Math.sqrt(dx *dx + dy*dy))/(1 + (1/(TotalLinksBetweenNodes+4)) * (d.linkindex + 1));
                           return `M${d.source.x},${d.source.y} A${dr},${dr} 0 0,1 ${d.target.x},${d.target.y}`;
                       }else {
                           let dr = (Math.sqrt(dx *dx + dy*dy))/(1 + (1/(TotalLinksBetweenNodes+4)) * (d.linkindex));
                           return `M${d.source.x},${d.source.y} A${dr},${dr} 0 0,0 ${d.target.x},${d.target.y}`;
                       }
                   }
                   return `M${d.source.x},${d.source.y} A0,0 0 0,1 ${d.target.x},${d.target.y}`;
               }
               const start = performance.now();

               let ticks = 0;

               // Set the position attributes of links and nodes each time the simulation ticks.
               simulation.on("tick", () => {
                   ticks++;

               });

               // only render graph when simulation is done 
               simulation.on("end", () => {
                   const end = performance.now();
                   link.attr("d", arcPath);
                   edgepaths.attr("d",arcPath);
                   // Source - https://stackoverflow.com/a/60691259
                   // Posted by Michael Rovinsky, modified by community. See post 'Timeline' for change history
                   // Retrieved 2026-03-23, License - CC BY-SA 4.0
                   node
                   .attr("transform", d => `translate(${d.x},${d.y})`);

                   const time = end - start;
                   console.log("Duration: " + time);
                   console.log("Ticks: " + ticks);

               });

               return svg.node();


    }

    // select color of link based on syscall success rate
    private selectColor( successful_calls:number){

        if (successful_calls == 1){return "green";}
        else if (successful_calls== 0){return "red";}
        else if (successful_calls == -1){return "yellow";}
        else {return "blue";} // only for unhandled state

    }

    private selectColor_nodes( type:string){

        // https://colorbrewer2.org/?type=qualitative&scheme=Dark2&n=3
        if (type == "Process"){return "#1b9e77";}
        else if (type == "File"){return "#d95f02";}
        else if (type == "Socket"){return "#7570b3";}
        else {return "grey";} // only for unhandled state

    }

}
