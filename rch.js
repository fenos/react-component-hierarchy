const path = require('path');
const babylon = require('babylon');
const Promise = require('bluebird');
const readFile = Promise.promisify(require('fs').readFile);
const _ = require('lodash');

function extractModules(bodyItem) {
  if (bodyItem.type === 'ImportDeclaration') {
    return {
      name: bodyItem.specifiers[0].local.name,
      source: bodyItem.source.value,
    };
  }
  return null;
}

function extractChildComponents(tokens, imports) {
  let childComponents = [];
  for (var i = 0; i < tokens.length - 1; i++) {
    if (tokens[i].type.label === 'jsxTagStart' && tokens[i + 1].type.label === 'jsxName') {
      let childComponent = _.find(imports, { name: tokens[i + 1].value });
      if (childComponent) {
        childComponents.push(childComponent);
      }
    }
  }
  return childComponents;
}

function formatChild(child, parent, depth) {
  return {
    name: child.name,
    filename: path.join(path.dirname(parent.filename), child.source),
    children: [],
    depth,
  };
}

function extractExport(body) {
  let result;
  body.some(b => {
    if (b.type === 'ExportDefaultDeclaration') {
      result = b.declaration.name;
    }
    return result;
  });
  return result;
}

function findImportInArguments(func, imports, importNames) {
  const args = _.get(func, '.arguments', []).map(a => a.name);
  const foundImports = _.intersection(args, importNames);
  return _.get(foundImports, '[0]');
}

function findImportInExportDeclaration(body, exportIdentifier, imports) {
  let result;
  const importNames = imports.map(i => i.name);
  body.some(b => {
    if (b.type === 'VariableDeclaration'
      && b.declarations[0].id.name === exportIdentifier
      && b.declarations[0].init.type === 'CallExpression') {
      // If the export is being declared with the result of a function..
      // Try to find a reference to any of the imports either in the function arguments,
      // or in the arguments of any other functions being called after this function
      let func = b.declarations[0].init;
      while (!result && func) {
        result = findImportInArguments(func, imports, importNames);
        if (!result) {
          func = _.get(func, '.callee');
        }
      }
      if (result) {
        result = _.find(imports, { name: result });
      }
    }
    return result;
  });
  return result;
}

// - Find out what is being exported
// - Look for the export variable declaration
// - Look for any imported identifiers being used as a function parameter
// - Return that as the child
function findContainerChild(node, body, imports, depth) {
  const exportIdentifier = extractExport(body);
  const usedImport = findImportInExportDeclaration(body, exportIdentifier, imports);
  return usedImport && [formatChild(usedImport, node, depth)] || [];
}

function processFile(node, file, depth) {
  const ast = babylon.parse(file, {
    sourceType: 'module',
    plugins: ['jsx', 'classProperties'],
  });

  // Get a list of imports and try to figure out which are child components
  const imports = ast.program.body.map(extractModules).filter(i => !!i);
  if (_.find(imports, { name: 'React' })) {
    // Look for children in the JSX
    const childComponents = _.uniq(extractChildComponents(ast.tokens, imports));
    node.children = childComponents.map(c => formatChild(c, node, depth));
  } else {
    // Not JSX.. try to search for a wrapped component
    node.children = findContainerChild(node, ast.program.body, imports, depth);
  }
}

function formatNodeToPrettyTree(node) {
  if (node.hideContainers && node.name.indexOf('Container') > -1) {
    node.children[0].name += ' (*)';
    return formatNodeToPrettyTree(node.children[0]);
  }
  const newNode = node.children.length > 0 ?
  {
    label: node.name,
    nodes: node.children.map(formatNodeToPrettyTree),
    depth: node.depth,
  }
    :
  {
    label: node.name,
    depth: node.depth,
  };

  return newNode;
}

function processNode(nodeDef,done, depth) {
  let workCounter = 0;
  nodeDef.name = path.basename(nodeDef.filename).replace(/\.jsx?/, '');

  function recursiveWalk(node,done,depth) {
    workCounter++;
    const fileExt = path.extname(node.filename);
    if (fileExt === '') {
      // It's likely users will reference files that do not have an extension, try .js and then .jsx
      node.filename = `${node.filename}.js`;
    }
    readFile(node.filename, 'utf8')
      .then(file => {
        processFile(node, file, depth);
        node.children.forEach(c => recursiveWalk(c,done, depth + 1));
        if (--workCounter <= 0) {
          done(nodeDef);
        }
      })
      .catch((e) => {
        --workCounter;
        if (path.extname(node.filename) === '.js') {
          // Look for .jsx next
          node.filename = node.filename.replace('.js', '.jsx');
        } else {
          // Can't find the file.. possible third party module
          node.filename = '';
          if (workCounter <= 0) {
            done(nodeDef);
          }
          return;
        }
        recursiveWalk(node,done, depth);
      });
  }
  recursiveWalk(nodeDef,done,depth);
}

module.exports.processNode = processNode;
module.exports.formatNodeToPrettyTree = formatNodeToPrettyTree;