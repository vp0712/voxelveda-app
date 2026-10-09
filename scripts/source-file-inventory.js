'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');

function listSourceFiles(root){
 if(fs.existsSync(path.join(root,'.git'))){
  // A broken checkout must fail, rather than silently reducing scan coverage.
  return [...new Set(execFileSync('git',['ls-files','--cached','--others','--exclude-standard'],{cwd:root,encoding:'utf8'}).split('\n').filter(Boolean))].sort();
 }
 // Railway packages source without .git. Scan the actual packaged files;
 // installed dependencies and generated native build trees are separate inputs.
 const excluded=new Set(['.git','node_modules','.gradle','DerivedData']);
 const files=[];
 function walk(directory){
  for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
   const full=path.join(directory,entry.name);
   if(entry.isDirectory()){if(!excluded.has(entry.name))walk(full)}
   else if(entry.isFile())files.push(path.relative(root,full).split(path.sep).join('/'));
  }
 }
 walk(root);
 for(const essential of ['app.js','server.js','package.json']){
  if(!files.includes(essential))throw new Error('Source artifact is incomplete: '+essential);
 }
 return files.sort();
}
module.exports={listSourceFiles};
