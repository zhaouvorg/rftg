#!/usr/bin/env python3
"""Run the actual native new-game callbacks in a headless mock GTK oracle.

Usage:
  python3 /tmp/rftg-mobile-create-oracle.py --source ../rftgp \
      --trials 100 --steps 100 --seed 112121 > /tmp/create-trace.json

The generated C uses harness()/function() from the repository's existing
 tests/test_create_options_parity.py. No GUI or game process is launched.
Each trace's action is directly usable with changeConfiguration(state,key,value).
An action:null resets the JS state to normalizeConfiguration().
"""
from pathlib import Path
import argparse
import hashlib
import importlib.util
import json
import os
import subprocess
import sys
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path.cwd() if (Path.cwd()/'src/gui.c').exists() else Path.cwd()/'../rftgp')
    parser.add_argument('--trials', type=int, default=64)
    parser.add_argument('--steps', type=int, default=64)
    parser.add_argument('--seed', type=int, default=112121)
    parser.add_argument('--cc', default=os.environ.get('CC', 'cc'))
    parser.add_argument('--output', type=Path)
    parser.add_argument('--emit-c', type=Path)
    args = parser.parse_args()
    if args.trials < 1 or args.steps < 0:
        parser.error('trials must be positive and steps nonnegative')
    root = args.source.resolve()
    gui = (root / 'src/gui.c').read_text(encoding='utf-8')
    client = (root / 'src/client.c').read_text(encoding='utf-8')
    spec = importlib.util.spec_from_file_location('native_create_parity', root / 'tests/test_create_options_parity.py')
    native = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(native)
    # Keep both actual callback sets; replace only the original test driver.
    c = native.harness(gui, client).split('static void compare(int trial,int step)')[0]
    c += r'''
static const int public_ids[7] = {0,1,2,3,4,5,8};
static const char *option_keys[7] = {
 "advanced","disableGoals","disableTakeovers","orb","invasion","frontier","counterstrike"
};
static const char *boolean(int v) { return v ? "true" : "false"; }
static void print_state(int online) {
 GtkWidget *w=online ? online_widgets : local_widgets;
 int exp=online ? online_next_exp : local_next_exp;
 int players=online ? online_min_player->value : local_next_player;
 int mask=online ? online_next_arc1_mask : local_next_arc1_mask;
 int mode=online ? online_opt.game_mode : local_opt.game_mode;
 int i,n=0;
 printf("{\"selected\":[");
 for(i=0;i<7;i++)if(w[public_ids[i]].active) {
  if(n++)putchar(','); printf("%d",public_ids[i]);
 }
 printf("],\"players\":%d,\"expansion\":%d,\"arc1Mask\":%d,\"mode\":%d,\"maxPlayers\":%d",
        players,exp,mask,mode,exp_info[exp].max_players);
 for(i=0;i<7;i++) printf(",\"%s\":%s",option_keys[i],boolean(w[9+i].active));
 printf(",\"enabled\":{");
 for(i=0;i<7;i++)printf("%s\"%s\":%s",i?",":"",option_keys[i],boolean(w[9+i].sensitive));
 printf("},\"disabledExpansions\":[");
 n=0;
 for(i=0;i<7;i++)if(!w[public_ids[i]].sensitive) {
  if(n++)putchar(','); printf("%d",public_ids[i]);
 }
 printf("]}");
}
static void dump(int trial,int step,int index,int value,int *first) {
 local_opt.expanded=local_next_exp;
 local_resolve();online_resolve();
 if(!(*first)) putchar(','); *first=0;
 printf("\n{\"trial\":%d,\"step\":%d,\"action\":",trial,step);
 if(index<0) printf("null");
 else if(index==16)printf("{\"key\":\"players\",\"value\":%d}",value);
 else if(index<9)printf("{\"key\":\"expansion\",\"value\":%d}",index);
 else printf("{\"key\":\"%s\",\"value\":%s}",option_keys[index-9],boolean(value));
 printf(",\"local\":");print_state(0);
 printf(",\"online\":");print_state(1);
 putchar('}');
}
int main(int argc,char **argv) {
 unsigned int seed=argc>3?(unsigned int)strtoul(argv[3],NULL,0):112121u;
 int trials=argc>1?atoi(argv[1]):64,steps=argc>2?atoi(argv[2]):64;
 int trial,step,index,value,first=1;
 const int choices[15]={0,1,2,3,4,5,8,9,10,11,12,13,14,15,16};
 printf("{\"schema\":1,\"source\":\"actual gui.c and client.c callbacks\",\"trace\":[");
 for(trial=0;trial<trials;trial++) {
  local_setup();online_setup();dump(trial,-1,-1,0,&first);
  for(step=0;step<steps;step++) {
   seed=seed*1664525u+1013904223u;
   index=choices[(seed>>16)%15];
   if(index==16) {
    value=2+(seed%5);
    if(value>exp_info[local_next_exp].max_players)value=exp_info[local_next_exp].max_players;
    local_next_player=value; online_min_player->value=value;
    local_update_sensitivity();online_update_sensitivity();
   } else {
    value=!local_widgets[index].active;
    local_click(index);online_click(index);
   }
   dump(trial,step,index,value,&first);
  }
 }
 puts("\n]}");
 return 0;
}
'''
    if args.emit_c:
        args.emit_c.write_text(c, encoding='utf-8')
    with tempfile.TemporaryDirectory(prefix='rftg-create-oracle-') as temp:
        temp = Path(temp)
        source = temp/'oracle.c'
        binary = temp/'oracle'
        source.write_text(c, encoding='utf-8')
        compiler = subprocess.run([args.cc, '-std=c99', '-O2', str(source), '-o', str(binary)], capture_output=True, text=True)
        if compiler.returncode:
            sys.stderr.write(compiler.stderr)
            raise SystemExit(compiler.returncode)
        result = subprocess.run([str(binary), str(args.trials), str(args.steps), str(args.seed & 0xffffffff)], check=True, capture_output=True, text=True)
    data = json.loads(result.stdout)
    data['seed'] = args.seed & 0xffffffff
    data['trials'] = args.trials
    data['steps'] = args.steps
    data['sourceHashes'] = {name: hashlib.sha256(text.encode()).hexdigest() for name,text in [('src/gui.c',gui),('src/client.c',client)]}
    output = json.dumps(data, separators=(',',':'), ensure_ascii=False) + '\n'
    if args.output:
        args.output.write_text(output, encoding='utf-8')
    else:
        sys.stdout.write(output)

if __name__ == '__main__':
    main()
