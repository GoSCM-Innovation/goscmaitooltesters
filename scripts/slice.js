const fs = require('fs');
const path = require('path');

const jsPath = path.join(__dirname, '..', 'public', 'js', 'app_temp.js');
const lines = fs.readFileSync(jsPath, 'utf8').split('\n');

function sliceLines(start, end) {
    // 1-indexed to 0-indexed slicing
    return lines.slice(start - 1, end).join('\n') + '\n\n';
}

const stateJs = sliceLines(1, 30);
const mainJs = sliceLines(31, 636) + sliceLines(3140, 3198);
const utilsJs = sliceLines(637, 647) + sliceLines(1647, 1675);
const apiJs = sliceLines(648, 755) + sliceLines(1618, 1646) + sliceLines(964, 1004);
const analyzerJs = sliceLines(756, 963) + sliceLines(1676, 2253);
const bomJs = sliceLines(1005, 1617);
const visualizerJs = sliceLines(2254, 3139);

const jsDir = path.join(__dirname, '..', 'public', 'js');
fs.writeFileSync(path.join(jsDir, 'state.js'), stateJs);
fs.writeFileSync(path.join(jsDir, 'utils.js'), utilsJs);
fs.writeFileSync(path.join(jsDir, 'api.js'), apiJs);
fs.writeFileSync(path.join(jsDir, 'analyzer.js'), analyzerJs);
fs.writeFileSync(path.join(jsDir, 'bom.js'), bomJs);
fs.writeFileSync(path.join(jsDir, 'visualizer.js'), visualizerJs);
fs.writeFileSync(path.join(jsDir, 'main.js'), mainJs);

// Update index.html
const htmlPath = path.join(__dirname, '..', 'public', 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');

const scriptTags = `
  <script src="js/state.js"></script>
  <script src="js/utils.js"></script>
  <script src="js/api.js"></script>
  <script src="js/bom.js"></script>
  <script src="js/analyzer.js"></script>
  <script src="js/visualizer.js"></script>
  <script src="js/main.js"></script>
`.trim();

html = html.replace('<script src="js/app_temp.js"></script>', scriptTags);
fs.writeFileSync(htmlPath, html);

// Delete app_temp.js
fs.unlinkSync(jsPath);

console.log('Split and replacement completed successfully!');
