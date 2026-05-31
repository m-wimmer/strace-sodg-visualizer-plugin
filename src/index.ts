// Copyright (C) 2025 The Android Open Source Project
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// developed based on https://github.com/google/perfetto/blob/main/ui/src/plugins/com.example.Tabs/index.ts template from ff22e9c315215f85b53f851f0f72eac8463c538e

import m from 'mithril';

import {PerfettoPlugin} from '../../public/plugin';
import {Trace} from '../../public/trace';
import {App} from '../../public/app';
import {Setting} from 'src/public/settings';
import {z} from 'zod';
import neo4j, {Driver} from 'neo4j-driver';
import { NodeLinkPanel } from './node-link_panel';

export default class StraceNodeLink implements PerfettoPlugin {
    static readonly id = 'dev.strace.nodelink';
    static readonly description = 'Plugin to generate system entity graphs for strace by querying a Neo4j database instance. (Requires relaxation of CSP)';

    static neo4jURI: Setting<string>;
    static neo4jsecret: Setting<string>;
    static neo4juser: Setting<string>;
    static neo4jConnectionEstablished: boolean=false;
    static counter: number=0;

    static onActivate(app: App): void {

        StraceNodeLink.neo4jURI = app.settings.register({
            id: `${StraceNodeLink.id}#neo4j-uri`,
            name: 'Neo4j IP address',
            description: 'IP address of the neo4j instance',
            schema: z.string(),
            defaultValue: '',
            requiresReload: true,
        });
        StraceNodeLink.neo4juser = app.settings.register({
            id: `${StraceNodeLink.id}#neo4j-user`,
            name: 'Neo4j username',
            description: 'Username of the neo4j user used for the connection',
            schema: z.string(),
            defaultValue: '',
            requiresReload: true,
        });
        StraceNodeLink.neo4jsecret = app.settings.register({
            id: `${StraceNodeLink.id}#neo4j-secret`,
            name: 'Neo4j user password',
            description: 'Password for the neo4j user',
            schema: z.string(),
            defaultValue: '',
            requiresReload: true,
        });
    }

    // on trace load connection to databse is tested
    async onTraceLoad(trace: Trace) {
        const driver = neo4j.driver(StraceNodeLink.neo4jURI.get(),
                                    neo4j.auth.basic(StraceNodeLink.neo4juser.get(), 
                                                     StraceNodeLink.neo4jsecret.get()));
                                                     this.createPersistentTab(trace,driver);
                                                     this.connectNeo4J(driver);
    }

    private createPersistentTab(trace: Trace,driver: Driver) {
        // Register persistent tab - this tab is shown in the triple dot menu, and
        // can be opened and closed by the user or programmatically via showTab()
        // and hideTab().
        trace.tabs.registerTab({

            uri: 'dev.strace.nodelink#PersistentTab',
            isEphemeral: false,
            content: {
                getTitle: () => 'Node Link graph view',
                    render: () => m(NodeLinkPanel, {trace,driver}),
            },
        });

        trace.tabs.showTab('dev.strace.nodelink#PersistentTab');
    }

    // checks whether or not neo4j connection was established
    private async connectNeo4J(driver: Driver){
        console.log("Connecting to database");

        try{
            const result = await driver.getServerInfo();
            console.log(result);
            console.log("Connection established")
            StraceNodeLink.neo4jConnectionEstablished = true;

        }
        catch(e){

            console.log("Connection could not be established");
            console.log(e);
            StraceNodeLink.neo4jConnectionEstablished = false;
        }



    }


}

