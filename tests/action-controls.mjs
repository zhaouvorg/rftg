import assert from 'node:assert/strict';

// Expected artwork slots come from gui.c action_role_icon/action_icon, not
// the browser presentation module. In particular, 10/11/12 are NOT icon IDs.
export async function checkActionControls(page,model){
  await page.waitForFunction(()=>[...document.querySelectorAll('.action-option img')].every(e=>e.complete&&e.naturalWidth>0));
  const controls=await page.locator('.action-option').evaluateAll(es=>es.map(e=>{
    const r=e.getBoundingClientRect();
    return {key:e.dataset.key,name:e.getAttribute('aria-label'),image:e.querySelector('.action-icon').getAttribute('src'),prestige:!!e.querySelector('.action-prestige-mark'),repeat:e.querySelector('.action-repeat')?.textContent,width:r.width,height:r.height,top:r.top};
  }));
  assert.equal(controls.length,model.options.length,'all legal phase icons rendered');
  for(const c of controls){
    const value=+c.key,id=value&127,slot=id===4?3:id===6?5:id===10?25:id;
    const expected=id===11?'/assets/orb/ui/explore_orb_action_icon.png':id===12?'/assets/xcs/ui/frontier_any.png':`/assets/icons/${slot}.png`;
    assert.equal(c.image,expected,`PC artwork for action ${value}`);
    assert.equal(c.name,model.options.find(o=>o.key===c.key).label,'accessible phase name');
    assert.equal(c.prestige,!!(value&128),'separate prestige badge');
    assert.equal(c.repeat,id===4||id===6?'2':undefined,'second Develop/Settle badge');
    assert.ok(c.width>=44&&c.width<=56&&c.height===c.width,'compact touch target');
  }
  const rows=new Set(controls.map(c=>Math.round(c.top)));
  assert.ok(rows.size<=Math.ceil(controls.length/4),'at least four phase icons per row on a narrow phone');
  assert.equal(await page.locator('.action-options .option-detail').count(),0,'one shared description rather than a paragraph in every button');
  assert.equal(await page.locator('.action-options').evaluate(e=>e.scrollWidth<=e.clientWidth),true,'phase grid must not scroll horizontally');
}
