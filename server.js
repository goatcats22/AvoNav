const express = require('express');
const fs = require('fs');

const json_nodes = JSON.parse(fs.readFileSync(__dirname+"/data/avoriaz-nodes.geojson"));
const json_slopes = JSON.parse(fs.readFileSync(__dirname+"/data/avoriaz-slopes.geojson"));
const json_lifts = JSON.parse(fs.readFileSync(__dirname+"/data/avoriaz-lifts.geojson"));

const app = express();
const port = 8080;

app.use(express.json());

// sendFile will go here
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/frontend/index.html');
});

app.get('/lifts', (req, res) => {
    res.send(json_lifts);
});
app.get('/slopes', (req, res) => {
    res.send(json_slopes);
});
app.get('/nodes', (req, res) => {
    res.send(json_nodes);
});
app.get('/load', (req, res) => {
    const json_loads = JSON.parse(fs.readFileSync(__dirname+"/data/map-loads.json"));
    json_loads.loads++;
    fs.writeFileSync(__dirname + '/data/map-loads.json', JSON.stringify(json_loads));
    res.send(json_loads);
});

app.post('/directions', (req, res) => {
    /*  input [zore-3, zore-2, zore-1]
        output [
            {name: zore-3, type: node},
            {name: zore-a, type: slope},
            {name: zore-c, type: slope},
            {name: zore-e, type: slope},
            {name: zore-2, type: node},
            {name: Super Morzine, type: lift},
            {name: zore-1, type: node}
        ] */

    const stops = req.body.request;
    
    function getLiftCost(liftName) {
        let liftProperties;
        let typeFactor = 0;
        json_lifts.features.forEach(feature => {
            if (feature.properties.name === liftName) liftProperties = feature.properties;
        });
        switch (liftProperties.type) {
            case 'button lift':
                typeFactor = 0.7; break;
            case 'chair lift':
                if (liftProperties.capacity === 8) typeFactor = 0.4;
                else if (liftProperties.capacity === 6) typeFactor = 0.5;
                else if (liftProperties.capacity === 4) typeFactor = 0.6;
                else if (liftProperties.capacity === 3) typeFactor = 0.7;
                break;
            case 'gondola':
                typeFactor = liftProperties.capacity >= 10 ? 0.4 : 0.5; break;
            case 'cable car':
                typeFactor = 0.3; break;
            case 't-bar':
                typeFactor = 0.8; break;
        }
        return typeFactor * liftProperties.len;
    }

    function findShortestPath(start, end, filter) {
        let paths = [
            {cost: 0, nodes: [start]}
        ];

        let next = [start];
        let shortestPaths = [];
        let shortestCost = Infinity;

        while (next.length > 0) {
            let tmpNext = [];
            let newPaths = [];

            for (let i=0; i<next.length; i++) {
                let currentNodeID = next[i];
                let currentNodeProperties; 

                json_nodes.features.forEach(feature => {
                    if (feature.properties.id === currentNodeID) {
                        currentNodeProperties = feature.properties;
                    }
                });

                for (let j = 0; j < currentNodeProperties.next.length; j++) {
                    let nextnode = currentNodeProperties.next[j][0];
                    let connector = currentNodeProperties.next[j][1];
                    let isSlope = currentNodeProperties.next[j][2] === 1;
                    let slopeProperties;
                    json_slopes.features.forEach(feature => {
                        if (feature.properties.id === connector) {
                            slopeProperties = feature.properties;
                        }
                    });
                    let cost = isSlope ? slopeProperties.len : getLiftCost(connector);
                    let destinationFound = false;

                    if (isSlope) {
                        if (filter.blockedDifficulties.includes(slopeProperties.difficulty)) {
                            continue;
                        }
                    }

                    if (nextnode === end) destinationFound = true;

                    for (let k=0; k<paths.length; k++) {
                        if (paths[k].nodes[paths[k].nodes.length - 1] === currentNodeID && !paths[k].nodes.includes(nextnode)) {
                            let newPath = {
                                cost: paths[k].cost + cost,
                                nodes: [...paths[k].nodes, nextnode]
                            };
                            newPaths.push(newPath);

                            if (!tmpNext.includes(nextnode)) {
                                tmpNext.push(nextnode);
                            }

                            if (destinationFound) {
                                if (newPath.cost < shortestCost) {
                                    shortestCost = newPath.cost;
                                    shortestPaths = [newPath];
                                } else if (newPath.cost === shortestCost) {
                                    shortestPaths.push(newPath);
                                }
                            }
                        }
                    }
                }
                // Remove paths ending with the current node
                paths = paths.filter(p => p.nodes[p.nodes.length - 1] !== currentNodeID);
            }
            
            // If there are no new paths to explore, break the loop
            if (newPaths.every(p => p.cost > shortestCost) || newPaths.length === 0) {
                break;
            }
            // Update paths with new paths
            paths = paths.concat(newPaths);

            // Clear and update next array
            next = tmpNext;

        }
        return shortestPaths;
    }

    //const result = findShortestPath(stops[0], stops[1], {'blockedDifficulties': []});
    let filter = {'blockedDifficulties': []};
    let result = {
        "stats": {
            "len": 0,
            "lifts": {"button lift": 0, "chair lift": 0, "gondola": 0, "cable car": 0, "t-bar": 0},
            "slopes": {"very easy": 0, "easy": 0, "intermediate": 0, "expert": 0}
        },
        "steps": []
    };

    for (let i=0; i<stops.length - 1; i++) {
        let startID = stops[i];
        let endID = stops[i+1];
        let path = findShortestPath(startID, endID, filter)[0].nodes;
        result.steps.push({"name": startID, "type": "node"});
        for (let j=0; j<path.length-1; j++) {
            let nodeID = path[j];
            let nodeProperties;
            json_nodes.features.forEach(feature => {
                if (feature.properties.id === nodeID) {
                    nodeProperties = feature.properties;
                }
            });
            let slopeID; let liftID;
            nodeProperties.next.forEach(option => {
                if (option[0] === path[j+1]) {
                    if (option[2]===1) { //slope
                        slopeID = option[1];
                        result.steps.push({"name": slopeID, "type": "slope"});
                        json_slopes.features.forEach(feature => {
                            if (feature.properties.id === slopeID) {
                                result.stats.len += feature.properties.len;
                                result.stats.slopes[feature.properties.difficulty]++;
                            }
                        });
                    } else {
                        liftID = option[1];
                        result.steps.push({"name": liftID, "type": "lift"});
                        json_lifts.features.forEach(feature => {
                            if (feature.properties.name === liftID) {
                                result.stats.lifts[feature.properties.type]++;
                            }
                        });
                    }
                }
            });
        }
    }
    result.steps.push({"name": stops[stops.length-1], "type": "node"});

    res.send(JSON.stringify({'result': result}));

});

app.listen(port);
console.log('Server started at http://localhost:' + port);