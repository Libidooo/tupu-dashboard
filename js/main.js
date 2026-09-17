(function () {
  'use strict';
  var st = { data: null, selectedSects: [], yearRange: [0, 1300], highlight: null, brushAxis: null, brushRange: null };
  var $id = function (s) { return document.querySelector(s); };
  var container = $id('#vis-container'), tt = $id('#tooltip'), dp = $id('#detail-panel'), db = $id('#detail-body');

  var PERIODS = ['隋', '初唐', '武周', '盛唐', '中唐', '晚唐', '五代', '北宋', '南宋'];
  var CLASSES = ['工匠', '富众信士', '平民', '僧侣', '士人', '官员'];
  var REGIONS = ['成都', '眉山', '蒲江', '绵阳', '资中', '内江', '安岳', '大足', '广元', '巴中', '其他'];
  var RDIST = { '成都': 0, '眉山': 70, '蒲江': 80, '绵阳': 120, '资中': 140, '内江': 170, '安岳': 170, '大足': 200, '广元': 270, '巴中': 350, '其他': 250 };
  var CLASS_COLORS = {'工匠':'#e67e22','富众信士':'#3498db','平民':'#95a5a6','僧侣':'#9b59b6','士人':'#1abc9c','官员':'#e74c3c','未知':'#7f8c8d'};
  var UNIT_SIZES = {'个人': 2, '家庭': 3, '社邑': 4, '群体': 5};

  var rotY = 0.3, rotX = -0.1;
  var panX = 0, panY = 0;
  var drag = false, dragMoved = false, dSx, dSy, dRy, dRx;
  var W, H, cx, cy, sc;
  var svg, zoomG, g, nodeG, dots = [], dynItems = [], dotBaseR = 4;
  var glowFilter;

  var STEP = 0.12;
  function xP(p) { var i = PERIODS.indexOf(p); return i >= 0 ? (i - 3) * STEP : 0; }
  function yP(c) { var i = CLASSES.indexOf(c); return i >= 0 ? (i - 2.5) * STEP : (c === '未知' ? -0.42 : 0); }
  function zP(r) { var d = RDIST[r] || 175; return (d - 80) / 400; }

  function proj(x, y, z) {
    var cr = Math.cos(rotY), sr = Math.sin(rotY);
    var crx = Math.cos(rotX), srx = Math.sin(rotX);
    var rx1 = x * cr - z * sr, rz1 = x * sr + z * cr;
    var ry2 = y * crx - rz1 * srx, rz2 = y * srx + rz1 * crx;
    // depth fade: closer (neg rz2) = brighter, farther (pos rz2) = dimmer
    var depthFade = Math.max(0.2, Math.min(1, 0.65 - rz2 * 0.6));
    return { x: cx + rx1 * sc + panX, y: cy - ry2 * sc + panY, s: depthFade };
  }

  async function init() {
    try { st.data = await (await fetch('data/graph_data.json')).json(); }
    catch (e) { container.innerHTML = '<div style="padding:40px;color:#e74c3c;">加载数据失败: ' + e.message + '</div>'; return; }
    setupUI();
    try { render(); }
    catch (e) { container.innerHTML = '<div style="padding:40px;color:#e74c3c;">渲染失败: ' + e.message + '<br>' + (e.stack||'').substring(0, 300) + '</div>'; }
  }

  function setupUI() {
    var sel = $id('#sect-filter');
    st.data.stats.sects.forEach(function (s) { var o = document.createElement('option'); o.value = s; o.textContent = s; o.selected = true; sel.appendChild(o); });
    st.selectedSects = st.data.stats.sects.slice();
    sel.addEventListener('change', function () { st.selectedSects = Array.from(sel.selectedOptions).map(function (o) { return o.value; }); applyFilter(); });
    var mn = $id('#year-min'), mx = $id('#year-max'), mnV = $id('#year-min-val'), mxV = $id('#year-max-val');
    var yrs = st.data.nodes.filter(function (n) { return n.type === 'inscription'; }).map(function (d) { return d.year_start; }).filter(function (y) { return y != null; });
    var yMin = Math.min.apply(null, yrs), yMax = Math.max.apply(null, yrs);
    mn.min = yMin; mn.max = yMax; mn.value = yMin; mx.min = yMin; mx.max = yMax; mx.value = yMax;
    mnV.textContent = yMin; mxV.textContent = yMax;
    mn.addEventListener('input', function () { var v = +mn.value; if (v > +mx.value) return; st.yearRange[0] = v; mnV.textContent = v; applyFilter(); });
    mx.addEventListener('input', function () { var v = +mx.value; if (v < +mn.value) return; st.yearRange[1] = v; mxV.textContent = v; applyFilter(); });
  }

  function render() {
    var cfg = st.data.config;
    var ins = st.data.nodes.filter(function (n) { return n.type === 'inscription'; });
    W = container.clientWidth || 1200; H = container.clientHeight || 700;
    container.innerHTML = '';

    svg = d3.select(container).append('svg').attr('width', W).attr('height', H);
    zoomG = svg.append('g');
    g = zoomG.append('g');

    sc = Math.min(W, H) * 2.0;
    cx = W / 2; cy = H / 2;

    dynItems = []; dots = [];
    var planeG = g.append('g');
    var gridG = g.append('g');
    var edgesG = g.append('g');
    nodeG = g.append('g');
    var axisG = g.append('g');

    // SVG 滤镜：发光光晕
    var defs = svg.append('defs');
    glowFilter = defs.append('filter').attr('id', 'glow').attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%');
    glowFilter.append('feGaussianBlur').attr('stdDeviation', '2').attr('result', 'blur');
    glowFilter.append('feMerge').append('feMergeNode').attr('in', 'blur');
    glowFilter.append('feMerge').append('feMergeNode').attr('in', 'SourceGraphic');
    // 更大的光晕
    var bigGlow = defs.append('filter').attr('id', 'glow-big').attr('x', '-100%').attr('y', '-100%').attr('width', '300%').attr('height', '300%');
    bigGlow.append('feGaussianBlur').attr('stdDeviation', '4').attr('result', 'blur');
    bigGlow.append('feMerge').append('feMergeNode').attr('in', 'blur');
    bigGlow.append('feMerge').append('feMergeNode').attr('in', 'SourceGraphic');

    ['axis-x','axis-y','axis-z'].forEach(function(id){
      defs.append('marker').attr('id',id).attr('viewBox','0 0 10 10').attr('refX',8).attr('refY',5)
        .attr('markerWidth',8).attr('markerHeight',8).attr('orient','auto')
        .append('path').attr('d','M 0 0 L 10 5 L 0 10 Z').attr('fill','#6a9aba');
    });

    function addLine(x1, y1, z1, x2, y2, z2, color, w, dash, group) {
      var parent = group || gridG;
      var el = parent.append('line').attr('class', 'dyn').attr('stroke', color || '#3a4a5a').attr('stroke-width', w || 0.5);
      if (dash) el.attr('stroke-dasharray', dash);
      dynItems.push({ el: el, p1: { x: x1, y: y1, z: z1 }, p2: { x: x2, y: y2, z: z2 } });
    }
    function addText(text, x, y, z, anchor, color, size) {
      var el = g.append('text').attr('class', 'dyn').attr('text-anchor', anchor || 'middle').attr('fill', color || '#8a9bb5').attr('font-size', size || '10px').text(text);
      dynItems.push({ el: el, p: { x: x, y: y, z: z } });
    }
    function addPoly(pts, fill, stroke, sw, op, group) {
      var parent = group || g;
      var el = parent.append('polygon').attr('class', 'dyn').attr('fill', fill).attr('stroke', stroke || 'none').attr('stroke-width', sw || 0).attr('opacity', op || 1);
      dynItems.push({ el: el, pts: pts });
    }

    var z0 = zP('成都'), zE = zP(REGIONS[REGIONS.length - 1]);
    var xS = xP(PERIODS[0]), xE = xP(PERIODS[PERIODS.length - 1]);
    var yB = yP('工匠'), yT = yP('官员');

    // 网格线
    PERIODS.forEach(function (p) { var x = xP(p); if (x !== 0) addLine(x, yB, 0, x, yT, 0, '#b0b8c0', 0.4, null, gridG); });
    CLASSES.forEach(function (c) { var y = yP(c); if (y !== 0) addLine(xS, y, 0, xE, y, 0, '#b0b8c0', 0.4, null, gridG); });
    REGIONS.forEach(function (r) { var z = zP(r); if (z !== 0) addLine(xS, 0, z, xE, 0, z, '#c0c8d0', 0.3, '3,3', gridG); });

    // 阶层水平面（覆盖所有题记的范围）
    var pXLo = xS - 0.2, pXHi = xE + 0.2, pZLo = z0 - 0.12, pZHi = zE + 0.12;
    CLASSES.forEach(function (c) {
      var y = yP(c), col = CLASS_COLORS[c] || '#7f8c8d';
      addPoly([{x:pXLo,y:y,z:pZLo},{x:pXHi,y:y,z:pZLo},{x:pXHi,y:y,z:pZHi},{x:pXLo,y:y,z:pZHi}], col, col, 0.3, 0.06, planeG);
      addPoly([{x:pXLo,y:y,z:pZLo},{x:pXHi,y:y,z:pZLo},{x:pXHi,y:y,z:pZHi},{x:pXLo,y:y,z:pZHi}], 'none', col, 0.7, 0.18, planeG);
    });

    // 所有维度标签（半透明深色底框 + 白色文字）
    CLASSES.forEach(function (c) {
      var y = yP(c), col = CLASS_COLORS[c]||'#5a6a7a';
      addPoly([{x:xS-0.58,y:y-0.04,z:-0.01},{x:xS-0.18,y:y-0.04,z:-0.01},{x:xS-0.18,y:y+0.04,z:-0.01},{x:xS-0.58,y:y+0.04,z:-0.01}], col, col, 0.4, 0.35, planeG);
      addText(c, xS - 0.42, y, 0, 'end', '#fff', '11px');
    });
    PERIODS.forEach(function (p) {
      var x = xP(p), txt = p.replace('初唐','初').replace('盛唐','盛').replace('中唐','中').replace('晚唐','晚');
      addPoly([{x:x-0.14,y:yB-0.46,z:-0.01},{x:x+0.14,y:yB-0.46,z:-0.01},{x:x+0.14,y:yB-0.38,z:-0.01},{x:x-0.14,y:yB-0.38,z:-0.01}], '#e74c3c', '#e74c3c', 0.3, 0.3, planeG);
      addText(txt, x, yB - 0.42, 0, 'middle', '#fff', '10px');
    });
    REGIONS.forEach(function (r) {
      var z = zP(r);
      addPoly([{x:xE+0.32,y:-0.28,z:z-0.03},{x:xE+0.60,y:-0.28,z:z-0.03},{x:xE+0.60,y:-0.16,z:z-0.03},{x:xE+0.32,y:-0.16,z:z-0.03}], '#2980b9', '#2980b9', 0.3, 0.3, planeG);
      addText(r, xE + 0.42, -0.22, z, 'start', '#fff', '9px');
    });

    // 维度轴标题（深色半透明底框）
    addPoly([{x:-0.20,y:yB-0.82,z:-0.03},{x:0.20,y:yB-0.82,z:-0.03},{x:0.20,y:yB-0.66,z:-0.03},{x:-0.20,y:yB-0.66,z:-0.03}], '#c0392b', 'none', 0, 0.4, planeG);
    addText('时间 →', 0, yB - 0.72, 0, 'middle', '#fff', '12px');
    addPoly([{x:-0.14,y:-0.08,z:zE+0.70},{x:0.14,y:-0.08,z:zE+0.70},{x:0.14,y:-0.08,z:zE+0.90},{x:-0.14,y:-0.08,z:zE+0.90}], '#2471a3', 'none', 0, 0.4, planeG);
    addText('地区', 0, -0.08, zE + 0.78, 'middle', '#fff', '12px');
    addPoly([{x:xS-0.86,y:yT+0.20,z:-0.02},{x:xS-0.58,y:yT+0.20,z:-0.02},{x:xS-0.58,y:yT+0.40,z:-0.02},{x:xS-0.86,y:yT+0.40,z:-0.02}], '#1e8449', 'none', 0, 0.4, planeG);
    addText('阶层', xS - 0.72, yT + 0.3, 0, 'middle', '#fff', '12px');

    // 题记节点
    ins.forEach(function (d) {
      var px = xP(d.period), py = yP(d.classType || d.class), pz = zP(d.region);
      if (px === undefined) px = 0;
      if (py === undefined) py = 0;
      var go = 0;
      if (d.gender === '男') go = -0.08; else if (d.gender === '女') go = 0.08;

      // 形状
      var sh = 'circle';
      if (d.classUnit === '家庭') sh = 'rect';
      else if (d.classUnit === '社邑') sh = 'triangle';
      else if (d.classUnit === '群体') sh = 'diamond';

      // 大小：组织形式映射
      var baseR = UNIT_SIZES[d.classUnit] || 3;
      if (d.classUnit === '未知' || !d.classUnit) baseR = 2.5;

      var grp = nodeG.append('g').attr('class', 'dot-grp').attr('data-id', d.id).attr('data-z', pz);
      var col = cfg.sectColors[d.sect] || '#555';
      var strk = cfg.religionTypeColors[d.religionType] || '#555';

      // 形状元素
      var shapeEl;
      var isCirc = sh === 'circle';
      if (isCirc) { shapeEl = grp.append('circle').attr('r', baseR); }
      else if (sh === 'rect') { var s = baseR * 0.8; shapeEl = grp.append('rect').attr('x', -s).attr('y', -s).attr('width', s*2).attr('height', s*2); }
      else if (sh === 'triangle') { var s = baseR * 1.2; shapeEl = grp.append('polygon').attr('points', '0,'+(-s)+' '+(-s*0.87)+','+(s*0.5)+' '+(s*0.87)+','+(s*0.5)); }
      else { var s = baseR * 0.9; shapeEl = grp.append('polygon').attr('points', '0,'+(-s)+' '+(s*0.65)+',0 0,'+s+' '+(-s*0.65)+',0'); }

      shapeEl.attr('fill', col).attr('stroke', strk).attr('stroke-width', 1.2).attr('opacity', 0.85);

      // 发光圈（隐藏默认）
      var glowCircle = grp.append('circle').attr('r', baseR + 3).attr('fill', 'none').attr('stroke', col).attr('stroke-width', 1).attr('opacity', 0).attr('filter', 'url(#glow)');

      // 交互
      grp.on('mouseenter', function (ev) {
        d3.select(this).select('*:not(circle:last-child)').attr('opacity', 1).attr('stroke-width', 2.5);
        glowCircle.attr('opacity', 0.6);
        showTT(ev, d, grp);
      }).on('mousemove', function (ev) { moveTT(ev); })
      .on('mouseleave', function () {
        var isDimmed = st.highlight && st.highlight.id !== d.id;
        d3.select(this).select('*:not(circle:last-child)').attr('opacity', isDimmed ? 0.15 : 0.85).attr('stroke-width', isDimmed ? 0.5 : 1.2);
        glowCircle.attr('opacity', 0);
        hideTT();
      }).on('click', function () { if (dragMoved) return; clickHighlight(d); showDetail(d); });

      dots.push({ id: d.id, x3: px + go, y3: py, z3: pz, data: d, el: grp, baseR: baseR, shapeEl: shapeEl, glowCircle: glowCircle, col: col, _isCircle: isCirc });
    });
    dots.sort(function (a, b) { return b.z3 - a.z3; });

    // 紫色连线
    var edges = [];
    function addEdges(groupKey, maxPerGroup) {
      var groups = {};
      ins.forEach(function(d, idx) {
        var k = d[groupKey] || '?';
        if (!groups[k]) groups[k] = [];
        groups[k].push(idx);
      });
      Object.values(groups).forEach(function(ids) {
        if (ids.length < 2) return;
        var limit = Math.min(ids.length * 2, maxPerGroup || 80);
        var count = 0;
        for (var i = 0; i < ids.length && count < limit; i++) {
          for (var j = i + 1; j < ids.length && count < limit; j++) {
            edges.push({ s: ids[i], t: ids[j] });
            count++;
          }
        }
      });
    }
    addEdges('region', 30);
    addEdges('period', 30);
    addEdges('classType', 30);

    var edgeEls = [];
    edges.forEach(function(e) {
      var el = edgesG.append('line').attr('stroke', '#9b59b6').attr('stroke-width', 0.3).attr('opacity', 0.12);
      edgeEls.push({ el: el, si: e.s, ti: e.t });
    });
    st._edges = edgeEls;
    st._insRef = ins;

    updateProj();

    // 交互
    svg.style('cursor', 'grab');
    svg.call(d3.zoom().scaleExtent([0.2, 5]).filter(function (ev) { return ev.type === 'wheel' || ev.type === 'dblclick'; })
      .on('zoom', function (ev) { zoomG.attr('transform', ev.transform); }));
    svg.on('mousedown.rotate', function (ev) { drag = true; dragMoved = false; dSx = ev.clientX; dSy = ev.clientY; dRy = rotY; dRx = rotX; svg.style('cursor', 'grabbing'); });

    var raf = null;
    d3.select(window).on('mousemove.rotate', function (ev) {
      if (!drag) return;
      var dx = ev.clientX - dSx, dy = ev.clientY - dSy;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragMoved = true;
      if (raf) return;
      raf = requestAnimationFrame(function () {
        rotY = dRy + dx * 0.006;
        rotX = Math.max(-1.0, Math.min(0.8, dRx + (dSy - ev.clientY) * 0.004));
        updateProj(); raf = null;
      });
    }).on('mouseup.rotate', function () { if (drag) { drag = false; svg.style('cursor', 'grab'); if (raf) { cancelAnimationFrame(raf); raf = null; } } });

    updateLeg(cfg);
    st._ins = ins; initSearchPanel();
  }

  function updateProj() {
    dynItems.forEach(function (it) {
      if (it.p1) {
        var p1 = proj(it.p1.x, it.p1.y, it.p1.z), p2 = proj(it.p2.x, it.p2.y, it.p2.z);
        it.el.attr('x1', p1.x).attr('y1', p1.y).attr('x2', p2.x).attr('y2', p2.y);
      } else if (it.pts) {
        var pp = it.pts.map(function(p){ var pp=proj(p.x,p.y,p.z); return pp.x+','+pp.y; });
        it.el.attr('points', pp.join(' '));
      } else if (it.p) {
        var p = proj(it.p.x, it.p.y, it.p.z);
        it.el.attr('x', p.x).attr('y', p.y).attr('opacity', Math.min(1, Math.max(0.3, (p.s - 0.3) * 2)));
      }
    });
    if (st._edges && st._insRef) {
      dots.forEach(function(d) { d._pos = proj(d.x3, d.y3, d.z3); });
      st._edges.forEach(function(e) {
        if (e.si >= dots.length || e.ti >= dots.length) return;
        var p1 = dots[e.si]._pos, p2 = dots[e.ti]._pos;
        if (p1 && p2) e.el.attr('x1', p1.x).attr('y1', p1.y).attr('x2', p2.x).attr('y2', p2.y);
      });
    }
    dots.forEach(function (d) {
      var p = proj(d.x3, d.y3, d.z3);
      if (!p) return;
      var r = Math.max(2, d.baseR * p.s);
      var isHL = st.highlight && st.highlight.id === d.id;
      var isDimmed = st.highlight && st.highlight.id !== d.id && !st.highlight.group[d.id];
      var op = Math.min(0.95, p.s * 0.5 + 0.35);
      if (st.highlight) op = isHL ? 1 : (isDimmed ? 0.12 : op * 0.85);
      d.el.attr('transform', 'translate(' + p.x + ',' + p.y + ')');
      d.shapeEl.attr('opacity', op).attr('stroke-width', Math.max(0.5, 1.2 * p.s * (isHL ? 2 : 1)));
      if (d._isCircle) d.shapeEl.attr('r', r);
      d.glowCircle.attr('opacity', isHL ? 0.5 : 0).attr('r', d.baseR + 4 + (1 - p.s) * 3);
    });
    var grps = nodeG.selectAll('.dot-grp').nodes();
    grps.sort(function (a, b) {
      var za = +(a.getAttribute('data-z') || 0);
      var zb = +(b.getAttribute('data-z') || 0);
      return zb - za;
    });
    grps.forEach(function (g) { g.parentNode.appendChild(g); });
  }

  function applyFilter() {
    var ss = st.selectedSects, y1 = st.yearRange[0], y2 = st.yearRange[1];
    st.data.nodes.filter(function(n){return n.type==='inscription';}).forEach(function (d) {
      var v = ss.indexOf(d.sect) !== -1 && (d.year_start == null || (d.year_start >= y1 && d.year_start <= y2));
      nodeG.selectAll('[data-id="' + d.id + '"]').select('*').attr('opacity', v ? 0.85 : 0.03);
    });
  }

  function clickHighlight(d) {
    if (st.highlight && st.highlight.id === d.id) { st.highlight = null; updateProj(); return; }
    var group = {};
    dots.forEach(function(dd) { if (dd.data.region === d.region || dd.data.period === d.period || dd.data.classType === d.classType) group[dd.id] = true; });
    st.highlight = { id: d.id, region: d.region, period: d.period, classType: d.classType, group: group };
    updateProj();
  }

  function toggleSF(s) {
    var sel = $id('#sect-filter'), opts = Array.from(sel.options);
    if (opts.every(function(o){return o.selected;})) opts.forEach(function(o){o.selected=o.value===s;});
    else { var o = opts.find(function(o){return o.value===s;}); if(o) o.selected=!o.selected; if(opts.every(function(o){return !o.selected;})) opts.forEach(function(o){o.selected=true;}); }
    sel.dispatchEvent(new Event('change'));
  }

  function updateLeg(cfg) {
    var el = d3.select('#legend-items'); el.html('');
    el.append('div').style('font-size','11px').style('color','#5a7a9a').style('margin-bottom','4px').text('阶层类型:');
    Object.entries(CLASS_COLORS).forEach(function(e){ var i=el.append('div').attr('class','legend-item'); i.append('div').attr('class','legend-color').style('background',e[1]); i.append('span').text(e[0]); });
    el.append('div').style('margin-top','6px').style('border-top','1px solid #2a3a4a').style('padding-top','6px').style('font-size','11px').style('color','#5a7a9a').text('组织形式(点大小):');
    [['个人','●'],['家庭','□'],['社邑','△'],['群体','◇']].forEach(function(e){ var i=el.append('div').attr('class','legend-item'); i.append('span').style('margin-right','4px').text(e[1]); i.append('span').text(e[0]); });
    el.append('div').style('margin-top','6px').style('border-top','1px solid #2a3a4a').style('padding-top','6px').style('font-size','11px').style('color','#5a7a9a').text('宗派:');
    Object.entries(cfg.sectColors).forEach(function(e){ var i=el.append('div').attr('class','legend-item').on('click',function(){toggleSF(e[0]);}); i.append('div').attr('class','legend-color').style('background',e[1]); i.append('span').text(e[0]); });
  }

  function showTT(ev, d, grp) {
    tt.style.display = 'block';
    tt.innerHTML = '<div class="tt-title">' + d.name + '</div>' +
      '<div class="tt-row"><span class="tt-label">年代</span><span class="tt-value">' + d.period + ' (' + (d.year_raw||'') + ')</span></div>' +
      '<div class="tt-row"><span class="tt-label">地区</span><span class="tt-value">' + d.region + '</span></div>' +
      '<div class="tt-row"><span class="tt-label">出资者</span><span class="tt-value">' + (d.patron||'不详') + '</span></div>' +
      '<div class="tt-row"><span class="tt-label">宗派</span><span class="tt-value">' + d.sect + '</span></div>' +
      '<div class="tt-row"><span class="tt-label">阶层</span><span class="tt-value">' + (d.classType||'') + (d.classUnit!=='个人'?'('+(d.classUnit||'')+')':'') + '</span></div>' +
      '<div class="tt-row"><span class="tt-label">祈愿</span><span class="tt-value">' + (d.vowDetail||d.vow||'信息不详') + '</span></div>';
    moveTT(ev);
  }

  function moveTT(e) {
    var r = container.getBoundingClientRect(), x = e.clientX - r.left + 12, y = e.clientY - r.top - 10;
    if (x + tt.offsetWidth > r.width - 10) x = e.clientX - r.left - tt.offsetWidth - 12;
    if (y + tt.offsetHeight > r.height - 10) y = r.height - tt.offsetHeight - 10;
    if (y < 10) y = 10;
    tt.style.left = x + 'px'; tt.style.top = y + 'px';
  }

  function hideTT() { tt.style.display = 'none'; }

  function showDetail(d) {
    dp.classList.add('open');
    st._detailData = d;
    buildDetailView(d);
  }

  function buildDetailView(d) {
    db.innerHTML = [
      ['题记名称', d.name], ['朝代', d.period], ['公元纪年', d.year_raw||''], ['地区', d.region],
      ['出资者', d.patron||'不详'], ['身份原文', d.identity||'不详'],
      ['性别', d.gender], ['阶层类型', d.classType||''], ['组织形式', d.classUnit||''], ['宗派', d.sect],
      ['宗教类型', d.religion||'不详'], ['所造佛像', d.deity||'不详'],
      ['祈愿内容（一级）', d.vow||'信息不详'], ['祈愿内容（二级）', d.vowDetail||'信息不详']
    ].map(function(f){return '<div class="field"><span class="field-label">'+f[0]+'</span><span class="field-value">'+f[1]+'</span></div>';}).join('') +
    (d.yuanwen ? '<div class="field" style="margin-top:10px;border-top:1px solid #ddd;padding-top:10px;"><span class="field-label" style="display:block;margin-bottom:4px;">题记原文</span><span class="field-value" style="display:block;white-space:pre-wrap;line-height:1.6;font-size:12px;">'+d.yuanwen+'</span></div>' : '') +
    '<div style="margin-top:12px;border-top:1px solid #ddd;padding-top:8px;text-align:center;">' +
    '<button onclick="window.doCrossStats()" style="background:#8e44ad;color:#fff;border:none;padding:6px 16px;border-radius:4px;cursor:pointer;font-size:12px;">交叉统计 ▶</button></div>';
  }

  window.doCrossStats = function() {
    var d = st._detailData;
    if (!d) return;
    var region = d.region, period = d.period, cls = d.classType;
    var sameRegion = 0, samePeriod = 0, sameClass = 0;
    dots.forEach(function(dd) {
      if (dd.data.region === region) sameRegion++;
      if (dd.data.period === period) samePeriod++;
      if (dd.data.classType === cls) sameClass++;
    });
    var sectDist = {}; var total = 0;
    dots.forEach(function(dd) {
      if (dd.data.region === region || dd.data.period === period || dd.data.classType === cls) {
        total++; var s = dd.data.sect; sectDist[s] = (sectDist[s] || 0) + 1;
      }
    });
    var sectHtml = Object.entries(sectDist).sort(function(a,b){return b[1]-a[1];}).slice(0,6)
      .map(function(e){return '<span style="display:inline-block;margin:2px 6px 2px 0;padding:1px 6px;background:#f0ecf4;border-radius:3px;font-size:11px;">'+e[0]+'&nbsp;'+e[1]+'</span>';}).join('');
    db.innerHTML = '<div style="font-size:13px;line-height:1.9;">' +
      '<div style="font-weight:600;color:#8e44ad;margin-bottom:10px;font-size:14px;">交叉统计</div>' +
      '<div style="color:#555;border-left:3px solid #e74c3c;padding-left:8px;">同地区 <strong>'+region+'</strong>：'+sameRegion+' 条</div>' +
      '<div style="color:#555;border-left:3px solid #2980b9;padding-left:8px;">同年代 <strong>'+period+'</strong>：'+samePeriod+' 条</div>' +
      '<div style="color:#555;border-left:3px solid #27ae60;padding-left:8px;">同阶层 <strong>'+cls+'</strong>：'+sameClass+' 条</div>' +
      '<div style="margin-top:10px;border-top:1px solid #ddd;padding-top:8px;color:#555;">宗派分布（三者并集共'+total+'条）</div>' +
      '<div style="margin-top:4px;">'+sectHtml+'</div>' +
      '<div style="margin-top:12px;text-align:center;"><button onclick="window.doBackToDetail()" style="background:#5a6a7a;color:#fff;border:none;padding:6px 16px;border-radius:4px;cursor:pointer;font-size:12px;">◀ 返回题记</button></div></div>';
  };

  window.doBackToDetail = function() {
    var d = st._detailData;
    if (d) buildDetailView(d);
  };

  window.closeDetail = function(){
    dp.classList.remove('open');
    st._detailData = null;
    if (st.highlight) { st.highlight = null; updateProj(); }
  };

  function initSearchPanel() {
    var spPeriod = $id('#sp-period'), spRegion = $id('#sp-region'), spClass = $id('#sp-class'), spVow = $id('#sp-vow'), spKw = $id('#sp-keyword'), spList = $id('#sp-list'), spCount = $id('#sp-count');
    var allIns = st._ins || [];
    var periods = {}, regions = {}, classes = {}, vows = {};
    allIns.forEach(function(d) {
      if (d.period) periods[d.period] = 1;
      if (d.region) regions[d.region] = 1;
      if (d.classType) classes[d.classType] = 1;
      if (d.vow) vows[d.vow] = 1;
    });
    PERIODS.forEach(function(v) { spPeriod.appendChild(new Option(v, v)); });
    Object.keys(regions).sort().forEach(function(v) { spRegion.appendChild(new Option(v, v)); });
    Object.keys(classes).sort().forEach(function(v) { spClass.appendChild(new Option(v, v)); });
    var vowOrder = (st.data.config && st.data.config.vowOrder) || [];
    Object.keys(vows).sort(function(a, b) {
      var ia = vowOrder.indexOf(a), ib = vowOrder.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    }).forEach(function(v) { spVow.appendChild(new Option(v, v)); });
    function doFilter() {
      var pv = spPeriod.value, rv = spRegion.value, cv = spClass.value, vv = spVow.value, kw = spKw.value.trim().toLowerCase();
      var hits = [];
      allIns.forEach(function(d) {
        if (pv && d.period !== pv) return;
        if (rv && d.region !== rv) return;
        if (cv && d.classType !== cv) return;
        if (vv && d.vow !== vv) return;
        if (kw && (!d.name || d.name.toLowerCase().indexOf(kw) === -1)) return;
        hits.push(d);
      });
      spCount.textContent = hits.length + ' 条结果';
      spList.innerHTML = hits.slice(0, 80).map(function(d) {
        return '<div class="sp-item" data-id="' + d.id + '">' +
          '<div class="sp-item-name">' + (d.name||'?') + '</div>' +
          '<div class="sp-item-meta">' + (d.period||'') + ' · ' + (d.region||'') + ' · ' + (d.classType||'') + (d.classUnit!=='个人'?'('+(d.classUnit||'')+')':'') + (d.sect?' · '+d.sect:'') + (d.vow && d.vow!=='信息不详'?' · '+d.vow:'') + '</div></div>';
      }).join('');
      if (hits.length > 80) spList.innerHTML += '<div style="font-size:10px;color:#aaa;padding:4px;">…仅显示前80条</div>';
    }
    spPeriod.addEventListener('change', doFilter);
    spRegion.addEventListener('change', doFilter);
    spClass.addEventListener('change', doFilter);
    spVow.addEventListener('change', doFilter);
    spKw.addEventListener('input', doFilter);
    spList.addEventListener('click', function(ev) {
      var item = ev.target.closest('.sp-item');
      if (!item) return;
      var id = item.getAttribute('data-id');
      var d = null;
      for (var i = 0; i < allIns.length; i++) { if (allIns[i].id === id) { d = allIns[i]; break; } }
      if (!d) return;
      // 定位：平移到该点
      for (var j = 0; j < dots.length; j++) {
        if (dots[j].data.id === id) {
          var p = proj(dots[j].x3, dots[j].y3, dots[j].z3);
          panX += (W / 2 - p.x);
          panY += (H / 2 - p.y);
          break;
        }
      }
      clickHighlight(d);
      showDetail(d);
    });
    doFilter();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
