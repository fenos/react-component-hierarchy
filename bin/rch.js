#!/usr/bin/env node

'use strict'; // eslint-disable-line
const rch = require('./../rch.js');
const program = require('commander');
const path = require('path');
const tree = require('pretty-tree');

program
  .version('1.0.0')
  .usage('[opts] <path/to/rootComponent>')
  .option('-c, --hide-containers', 'Hide redux container components')
  .description('React component hierarchy viewer.')
  .parse(process.argv);

if (!program.args[0]) {
  program.help();
}

const hideContainers = program.hideContainers;

let workCounter = 0;
const filename = path.resolve(program.args[0]);

const rootNode = {
  filename,
  depth: 0,
  hideContainers: hideContainers
};

function done(rootNode) {
  console.log(tree(rch.formatNodeToPrettyTree(rootNode)));
  process.exit();
}


rch.processNode(rootNode,done, 1);
