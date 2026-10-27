// Node's test runner supplies these events; test stdout is never interpreted as results.
export default async function* reporter(events){
 const results=[];let summary=null;
 for await(const event of events){const d=event.data;
  if(['test:pass','test:fail'].includes(event.type))results.push({name:d.name,file:d.file||null,nesting:d.nesting,result:d.skip?'skipped':d.todo?'blocked':event.type==='test:pass'?'passed':'failed'});
  if(event.type==='test:summary'&&d.file===undefined)summary={success:d.success,counts:d.counts};
 }
 yield JSON.stringify({schemaVersion:1,results,summary});
}
