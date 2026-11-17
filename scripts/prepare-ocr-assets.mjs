import{mkdirSync,copyFileSync,readdirSync,readFileSync,writeFileSync}from'node:fs';
import{createHash}from'node:crypto';
import{fileURLToPath}from'node:url';
import{resolve,dirname}from'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export function prepareOcrAssets(){
 const dest=resolve(root,'public/ocr/v7');mkdirSync(dest+'/core',{recursive:true});
 const manifest=JSON.parse(readFileSync(dest+'/models.json','utf8'));
 for(const entry of manifest.models){const bytes=readFileSync(dest+'/lang/'+entry.file);if(createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw Error('OCR model checksum mismatch: '+entry.file);}
 const pkg=JSON.parse(readFileSync(resolve(root,'node_modules/tesseract.js/package.json'),'utf8'));
 if(pkg.version!=='7.0.0')throw Error('OCR worker protocol requires pinned Tesseract.js 7.0.0');
 copyFileSync(resolve(root,'node_modules/tesseract.js/dist/worker.min.js'),dest+'/worker.min.js');
 copyFileSync(resolve(root,'node_modules/tesseract.js/dist/worker.min.js.LICENSE.txt'),dest+'/worker.min.js.LICENSE.txt');
 for(const name of readdirSync(resolve(root,'node_modules/tesseract.js-core')))if(/^tesseract-core-(?:(?:relaxedsimd|simd)-)?lstm\.wasm\.js$/.test(name))copyFileSync(resolve(root,'node_modules/tesseract.js-core',name),dest+'/core/'+name);
 for(const [pkg,source,name]of[['tesseract.js','LICENSE.md','tesseract-js-Apache-2.0.txt'],['tesseract.js-core','LICENSE','tesseract-core-Apache-2.0.txt']])writeFileSync(resolve(root,'public/licenses',name),readFileSync(resolve(root,'node_modules',pkg,source),'utf8').trimEnd()+'\n');
 console.log('Pinned same-origin OCR assets prepared; model checksums verified.');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))prepareOcrAssets();
