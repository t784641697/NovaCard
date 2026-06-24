// 上传脚本到生产
const SSH=require('ssh2'),fs=require('fs');
const c=new SSH.Client();
const FILE=process.argv[2];
const REMOTE=process.argv[3];
c.on('ready',()=>{
  c.sftp((err,sftp)=>{
    if(err){console.error('sftp err',err.message);c.end();return;}
    sftp.open(REMOTE,'w',0o644,(e,handle)=>{
      if(e){console.error('open err',e.message);c.end();return;}
      const buf=fs.readFileSync(FILE);
      sftp.write(handle,buf,0,buf.length,0,(e2)=>{
        if(e2){console.error('write err',e2.message);c.end();return;}
        sftp.close(handle,()=>{console.log('OK',REMOTE,buf.length,'bytes');c.end();});
      });
    });
  });
}).on('error',e=>console.error('conn err',e.message))
.connect({host:'139.180.188.104',port:22,username:'root',privateKey:fs.readFileSync('/workspace/projects/.ssh/vultr_new_key')});
