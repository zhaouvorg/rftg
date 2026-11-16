import assert from 'node:assert/strict';

export async function clickAnswer(page,s,m,answer){
  const same=r=>r&&r.rv===answer.rv&&JSON.stringify(r.list)===JSON.stringify(answer.list)&&JSON.stringify(r.special)===JSON.stringify(answer.special);
  const option=m.options.find(o=>same(o.response));
  const click=async(group,key)=>{
    await page.locator(`.choice-option[data-group="${group}"][data-key="${key}"]`).click();
    if(m.mode==='actions'){
      assert.equal(await page.locator('#action-description').getAttribute('data-key'),key,'clicked phase description');
      assert.equal(await page.locator('#action-description strong').textContent(),m.options.find(o=>o.key===key).label);
    }
  };
  if(option&&m.mode==='placement'){
    const group=m.options.filter(o=>o.x===option.x&&o.y===option.y);assert.ok(group.length,`Missing placement group for ${option.key}`);
    await page.locator(`.orb-placement-target[data-key="${group[0].key}"]`).click();
    for(let i=1;i<group.length&&group[i-1].key!==option.key;i++)await page.locator('[data-action="rotate-placement"]').click();
    assert.equal(await page.locator('.placement-status').textContent(),`位置 (${option.x}, ${option.y}) · ${Math.round(option.rotation||0)}°`,'rotated placement selected through the map UI');
  }else if(option&&option.cell>=0)await page.locator(`.orb-target[data-key="${option.key}"]`).click();
  else if(option)await click('option',option.key);
  else if(same(m.pass))await click('pass','pass');
  else if(m.mode==='actions'){
    let values=answer.list.filter(v=>v>=0);const first=s.meta.advanced&&s.choice.args[0]===2?s.players[s.seat].actions[0]:-1;
    if(first>=0)values=values.filter(v=>v!==first);
    if(values.includes(12)){
      if(values.includes(5)){
        await click('list','5');await click('list','6');await click('list','12');
        if(answer.list[0]===5)await click('list','12');
      }else{for(const v of values)await click('list',String(v===12?5:v));await click('list','12');}
    }else for(const v of values)await click('list',String(v));
  }else{
    const groups=[];
    if(['start','payment','defend','two','takeover','replacement'].includes(m.mode))groups.push(['special',m.specialOptions,answer.special]);
    const values=m.mode==='settlePayment'?answer.list.slice(1):['takeover','replacement'].includes(m.mode)?[answer.rv]:answer.list;
    groups.push(['list',m.mode==='settlePayment'?m.paymentOptions:m.options,values]);
    for(const [group,options,selected]of groups){
      const remaining=[...(options||[])];
      for(const value of selected){const at=remaining.findIndex(o=>o.value===value);assert.ok(at>=0,`Missing ${group} ${value} in ${m.mode}`);const [o]=remaining.splice(at,1);await click(group,o.key);}
    }
  }
  const confirm=page.locator('[data-action="confirm"]');assert.ok(await confirm.isEnabled(),`UI cannot submit native answer ${JSON.stringify(answer)}`);await confirm.click();
}
