import {build} from 'esbuild';
import {cp, mkdir, readFile, writeFile} from 'node:fs/promises';

const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
for (const [name, entry] of [['api','cloud/function.ts'], ['backup','cloud/backup-function.ts']]) {
  const out = 'dist/' + name;
  await mkdir(out, {recursive:true});
  await build({
    entryPoints:[entry], bundle:true, platform:'node', target:'node22', format:'cjs',
    outfile:out + '/index.js', external:['@cloudbase/node-sdk'], legalComments:'eof'
  });
  await writeFile(out + '/package.json', JSON.stringify({
    name:'shixu-' + name, private:true, main:'index.js', type:'commonjs',
    dependencies:{'@cloudbase/node-sdk':manifest.dependencies['@cloudbase/node-sdk']}
  }, null, 2) + '\n');
  await cp('public/licenses', out + '/licenses', {recursive:true});
  console.log('Built ' + out);
}