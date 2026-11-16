export const DISPLAY_SETTINGS_KEY='rftg-display-settings';
export const DEFAULT_DISPLAY_SETTINGS=Object.freeze({cards:1,text:1});
export const DISPLAY_SCALE={min:.75,max:2,step:.05};

export function normalizeDisplaySettings(value){
  const scale=key=>typeof value?.[key]==='number'&&Number.isFinite(value[key])
    ?Math.min(DISPLAY_SCALE.max,Math.max(DISPLAY_SCALE.min,value[key]))
    :DEFAULT_DISPLAY_SETTINGS[key];
  return {cards:scale('cards'),text:scale('text')};
}
export function loadDisplaySettings(){
  try{return normalizeDisplaySettings(JSON.parse(localStorage.getItem(DISPLAY_SETTINGS_KEY)));}
  catch{return {...DEFAULT_DISPLAY_SETTINGS};}
}
export function applyDisplaySettings(settings){
  document.documentElement.style.setProperty('--card-scale',settings.cards);
  document.documentElement.style.setProperty('--font-scale',settings.text);
}
export function saveDisplaySettings(settings){
  try{localStorage.setItem(DISPLAY_SETTINGS_KEY,JSON.stringify(settings));return true;}
  catch{return false;}
}
