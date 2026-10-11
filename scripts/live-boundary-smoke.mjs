const endpoint=String(process.env.EDH_COMPANION_BASE||'http://127.0.0.1:43119').replace(/\/$/,'');
const token=process.env.EDH_PAIRING_TOKEN;
if(!token) throw new Error('EDH_PAIRING_TOKEN is required');

const healthRes=await fetch(endpoint+'/health',{cache:'no-store'});
if(!healthRes.ok) throw new Error('health '+healthRes.status);
const health=await healthRes.json();

const dashboardRes=await fetch(endpoint+'/bridge/dashboard-state?adapter=chrome',{
  cache:'no-store',
  headers:{Authorization:'Bearer '+token}
});
if(!dashboardRes.ok) throw new Error('dashboard '+dashboardRes.status);
const dashboard=await dashboardRes.json();
for(const k of ['schema_version','revision','generated_at','observer','project_tasks','rdc','prepared_dispatch','executor_policy']){
  if(!Object.hasOwn(dashboard,k)) throw new Error('dashboard missing '+k);
}
if(dashboard.schema_version!=='1.0') throw new Error('unsupported dashboard schema '+dashboard.schema_version);

console.log(JSON.stringify({
  ok:true,
  health:{
    status:health.status||'ok',
    version:health.version||null,
    service_version:health.service_version||null,
    dashboard_schema_version:health.dashboard_schema_version||null
  },
  dashboard:{
    schema_version:dashboard.schema_version,
    revision:dashboard.revision,
    generated_at:dashboard.generated_at,
    executor_policy_mode:dashboard.executor_policy?.mode||null
  }
},null,2));
