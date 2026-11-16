/* Test-only observation inside gui_autoplay_make_choice, before any answer is
 * copied. All predicates and state are from the native single-player engine. */
{
    int mi, mn = 0, previous = g->advanced && arg1 == 2 ? g->p[who].action[0] : -1;
    fprintf(stderr, "MOBILE_STATE {\"pos\":%d,\"round\":%d,\"seat\":%d,\"currentAction\":%d,\"vpPool\":%d,\"cards\":[",
            autoplay_human_pos, g->round, who, g->cur_action, g->vp_pool);
    for (mi=0; mi<g->deck_size; mi++) {
        card *mc = &g->deck[mi];
        if (!(mc->where==WHERE_ACTIVE || mc->where==WHERE_ASIDE ||
             (mc->owner==who && (mc->where==WHERE_HAND || mc->where==WHERE_SAVED)))) continue;
        if(mn++)fputc(',', stderr);
        fprintf(stderr, "[%d,%d,%d,%d,%d,%d]", mi,mc->d_ptr->index,mc->owner,mc->where,mc->num_goods,mc->damaged);
    }
    fprintf(stderr, "],\"roles\":[");mn=0;
    if(type==CHOICE_ACTION)for(mi=0;mi<=ACT_XCS_FRONTIER_SETTLE+ACT_PRESTIGE;mi++) {
        int raw=mi&ACT_MASK;
        if(raw>ACT_XCS_FRONTIER_SETTLE || !action_legal_helper(g,who,mi))continue;
        if(!g->advanced && (raw==ACT_DEVELOP2 || raw==ACT_SETTLE2))continue;
        if(previous>=0 && raw==(previous&ACT_MASK))continue;
        if(previous>=0 && ((previous&ACT_PRESTIGE) && (raw==ACT_SEARCH || (mi&ACT_PRESTIGE))))continue;
        if(previous==ACT_SEARCH && (mi&ACT_PRESTIGE))continue;
        if(mn++)fputc(',',stderr);fprintf(stderr,"%d",mi);
    }
    fprintf(stderr,"]}\n");
}
