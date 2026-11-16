// Physical artifact multiplicities and printed fronts from src/orb.c.
const rows=[
 [3,'和平世界减费 2','science_nonmilitary_minus2',2,0,'science'],
 [4,'异星技术货物','technology_good_a',0,0,'technology'],
 [5,'穿越墙壁 / 屏障','wall_or_barrier',2,0,null],
 [4,'提升神器 / 基因军力 +2','uplift_a',0,1,'uplift'],
 [6,'移动力 +4','move_plus4',2,0,null],
 [2,'穿越屏障 / 军力 +2','barrier_or_military_plus2_a',1,0,null],
 [3,'发展减费 2','science_develop_minus2',1,0,'science'],
 [3,'穿越屏障 / 军力 +1','barrier_or_military_plus1',2,0,null],
 [3,'异星技术货物','technology_good_b',3,0,'technology'],
 [2,'发展减费 3','science_develop_minus3',1,0,'science'],
 [2,'穿越屏障 / 军力 +2','barrier_or_military_plus2_b',3,0,null],
 [2,'穿越屏障 / 军力 +3','barrier_or_military_plus3',2,0,null],
 [2,'和平世界减费 3','science_nonmilitary_minus3',2,0,'science'],
 [4,'提升神器','uplift_b',2,1,'uplift']
];
export const ARTIFACTS=rows.map(([copies,name,slug,vp,upliftStationVp,category],id)=>({id,copies,name,vp,upliftStationVp,category,image:`/assets/orb/artifacts/artifact_${String(id).padStart(2,'0')}_${slug}.png`}));
export const ARTIFACT_TOKENS=ARTIFACTS.flatMap(a=>Array(a.copies).fill(a));
