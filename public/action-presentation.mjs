// Match the PC action_role_icon mapping. Role 10 is Repair, not icon 10
// (the "no action" marker); Orb and Frontier have dedicated expansion art.
export function actionIcon(value,boosted=false){
  const id=value&127;
  if(boosted)return '/assets/xcs/ui/frontier_settle_boost.png';
  if(id===12)return '/assets/xcs/ui/frontier_any.png';
  if(id===11)return '/assets/orb/ui/explore_orb_action_icon.png';
  const slot=id===4?3:id===6?5:id===10?25:id;
  return `/assets/icons/${slot}.png`;
}

// Prestige bonuses follow the native phase handlers in engine.c.
const prestigeHints={
  1:'再多看 6 张、多留 1 张，可以与原有手牌混合后弃牌。',
  2:'再多看 6 张、多留 1 张，可以与原有手牌混合后弃牌。',
  3:'发展费用再减 2。',4:'发展费用再减 2。',
  5:'本阶段和平殖民费用减 3，军力增加 2。',
  6:'本阶段和平殖民费用减 3，军力增加 2。',
  7:'交易多抽 3 张，消费胜利点翻倍，并可使用额外的弃牌换分能力。',
  8:'消费胜利点改为 3 倍。',
  9:'再为一个横置货物世界生产，并抽 3 张牌。'
};
export function actionDescription(option){
  const id=option.value&127;
  const detail=id===0?'按类别搜索卡牌；与威望加成共用本局一次的使用机会。'
    :id===11?'提高 Orb 探索优先级，并执行全部三种 Orb 行动。'
    :option.detail;
  return option.value&128
    ?`${detail}。威望加成：花费 1 威望，${prestigeHints[id]}与搜索共用本局一次的使用机会。`
    :detail;
}
