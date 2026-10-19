/* vgr_D3 — koropletkarta (func_d3_karta / func_d3_karta_change).
 *
 * Geometrin kommer i sitt eget koordinatsystem (t.ex. SWEREF99 TM) och ritas med
 * d3.geoIdentity().reflectY(true), så ingen omprojicering behövs. Klassgränser, färger och
 * texter är beräknade i R. Datan kommer i kompakt form (expandCompact nedan): här räknas
 * bara varje områdes klass och förändringsvärden fram ur nivåvärdena, plus interaktiviteten.
 *
 * Lagerordning i SVG:en: bakgrund > kartgrupp (bas, data, överlager, markering) > bubblor >
 * årtal > ledarlinjer > etiketter > legend > rubriker.
 */
(function () {
  "use strict";
  var vgrD3 = window.vgrD3;

  function clamp(v, lo, hi) { return lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v)); }

  // ---------------------------------------------------------------------------
  //  Kompakt kodning (spec.compact, se func_d3_karta_bygg i R): packas upp till samma
  //  struktur som ritkoden nedan använder — år -> { id: värde }, GeoJSON och rows.
  // ---------------------------------------------------------------------------
  function decodeGeo(g, ids) {
    if (!g || g.type !== "vgrKompakt") return g;   // GeoJSON (t.ex. linjer) används som det är
    var q = g.q, ox = g.origin[0], oy = g.origin[1];
    function ring(r) {
      var out = [], x = 0, y = 0;
      for (var j = 0; j < r.length; j += 2) {
        if (j === 0) { x = r[0]; y = r[1]; } else { x += r[j]; y += r[j + 1]; }
        out.push([ox + x * q, oy + y * q]);
      }
      var a = out[0], b = out[out.length - 1];
      if (a && (a[0] !== b[0] || a[1] !== b[1])) out.push([a[0], a[1]]);
      return out;
    }
    return {
      type: "FeatureCollection",
      features: g.features.map(function (ytor, i) {
        return {
          type: "Feature",
          properties: { id: ids ? ids[i] : String(i + 1) },
          geometry: { type: "MultiPolygon", coordinates: ytor.map(function (p) { return p.map(ring); }) }
        };
      })
    };
  }

  function expandCompact(spec) {
    var ids = spec.ids, n = ids.length;
    function byId(arr, f) {
      var o = {};
      if (!arr) return o;
      for (var i = 0; i < n; i++) {
        var v = arr[i];
        if (v != null) { if (f) v = f(v); if (v != null) o[ids[i]] = v; }
      }
      return o;
    }
    function perYear(obj, f) {
      if (!obj) return obj;
      var o = {};
      Object.keys(obj).forEach(function (y) { o[y] = byId(obj[y], f); });
      return o;
    }
    // Områden som saknar rad ett år (spec.missing_rows) ska inte få värden det året
    var missing = spec.missing_rows || {};
    function withoutMissing(o, y) {
      var m = missing[y];
      if (!m || !m.length) return o;
      var ut = {};
      Object.keys(o).forEach(function (k) { ut[k] = o[k]; });
      m.forEach(function (i) { delete ut[ids[i]]; });
      return ut;
    }
    // Tooltip- och etikettkolumn: const (samma alla år) eller years; tal formateras här
    function column(c, years) {
      var f = c.num ? function (v) { return vgrD3.fmt(v, c.decimals, c.thousands); } : null;
      if (c.years) return perYear(c.years, f);
      var o = byId(c.const, f), ut = {};
      years.forEach(function (y) { ut[y] = withoutMissing(o, y); });
      return ut;
    }
    // Klass ur de inre klassgränserna: antal gränser som värdet når upp till (cut med right = FALSE)
    function classify(v, br) {
      if (v == null || isNaN(v)) return null;
      var c = 0;
      for (var k = 0; k < br.length; k++) if (v >= br[k]) c++;
      return c;
    }

    var level = spec.level_values;
    var allYears = level ? Object.keys(level) : [];
    spec.mode_order.forEach(function (k) { spec.modes[k].years.forEach(function (y) { if (allYears.indexOf(String(y)) < 0) allYears.push(String(y)); }); });
    var levelById = perYear(level);

    spec.mode_order.forEach(function (k) {
      var ms = spec.modes[k];
      if (k === "forandring") {
        // Förändringen räknas från ett startår som kan bytas i tidsreglaget (setFrom).
        // Underrubrikerna är skrivna i R med det ursprungliga startåret (subtitle_from).
        ms.all_years = ms.all_years || [ms.from_year].concat(ms.years);
        ms.subtitle_from = ms.from_year;
        ms.setFrom = function (fromYear) { changeFrom(ms, fromYear); };
        changeFrom(ms, ms.from_year);
      } else {
        ms.values = level ? levelById : null;
        ms.classes = ms.classes ? perYear(ms.classes)
          : perYear(level, function (v) { return classify(v, ms.breaks); });
      }
    });

    function changeFrom(ms, fromYear) {
      var base = level[fromYear] || [], fromById = byId(base);
      ms.from_year = fromYear;
      ms.years = ms.all_years.slice(ms.all_years.indexOf(fromYear) + 1);
      ms.values = {}; ms.from = {}; ms.to = {}; ms.classes = {};
      ms.years.forEach(function (y) {
        var to = level[y] || [], d = new Array(n), cl = new Array(n);
        for (var i = 0; i < n; i++) {
          var a = base[i], b = to[i], v = null;
          if (a != null && b != null) {
            v = b - a;
            if (ms.percentage) v = v / a * 100;
            if (!isFinite(v)) v = null;
          }
          // Klassen på det exakta värdet (som func_d3_karta_klass i R); det visade värdet med
          // 15 värdesiffror som när R skrev det till JSON, så att t.ex. lika förändringar
          // får samma plats i rangordningen
          cl[i] = classify(v, ms.breaks);
          d[i] = v == null ? null : +v.toPrecision(15);
        }
        ms.values[y] = byId(d);
        ms.from[y] = withoutMissing(fromById, y);
        ms.to[y] = levelById[y] || {};
        ms.classes[y] = byId(cl);
      });
    }

    spec.rows = {};
    ids.forEach(function (id, i) { spec.rows[id] = { name: spec.names[i] }; });
    spec.geo = decodeGeo(spec.geo, ids);
    spec.basemap = decodeGeo(spec.basemap);
    if (spec.overlay) spec.overlay.geo = decodeGeo(spec.overlay.geo);

    var LB = spec.labels, anchors = {};
    ids.forEach(function (id, i) { anchors[id] = [LB.anchors[2 * i], LB.anchors[2 * i + 1]]; });
    LB.anchors = anchors;
    if (LB.prefix) LB.prefix = column(LB.prefix, allYears);
    spec.tooltip.columns.forEach(function (c) { c.values = column(c, allYears); });
    if (spec.bubbles) spec.bubbles.values = perYear(spec.bubbles.values);
    if (spec.zoom_groups) spec.zoom_groups = byId(spec.zoom_groups);
  }

  // Tillgänglig bredd för kartan: förälderns innehållsbredd i sidans egna (oskalade) pixlar.
  // clientWidth påverkas inte av CSS-transform, så reveal.js skalning räknas inte in.
  function availableWidth(el) {
    var p = el.parentNode;
    if (!p || !p.clientWidth) return 0;
    var cs = window.getComputedStyle(p);
    return p.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
  }

  vgrD3.renderers.karta = function (el, spec) {
    if (spec.compact) expandCompact(spec);
    var W0 = spec.width, W = spec.width, H = spec.height, font = spec.font;
    // Responsiv layout (spec.responsive): får kartan inte plats i width ritas den i den bredd
    // som finns, i stället för att skalas ned. Text, förklaring och knappar behåller då sin
    // storlek. Under brytpunkten (t.ex. mobil) flyttas en förklaring till vänster eller höger
    // under kartan, så att kartan får hela bredden, och kartan blir högre än proportionellt.
    var RS = spec.responsive || {};
    var smal = false;
    if (RS.enabled) {
      // Vid omritning mäts bredden innan det gamla innehållet tas bort (se ResizeObserver nedan)
      var avail = spec.avail_width != null ? spec.avail_width : Math.floor(availableWidth(el));
      if (avail > 0 && avail < W0) {
        smal = avail < RS.breakpoint;
        H = smal ? Math.min(H, Math.round(Math.max(H * avail / W0, avail * 1.35))) : Math.round(H * avail / W0);
        W = avail;
        if (smal && (spec.legend.position === "left" || spec.legend.position === "right")) spec.legend.position = "bottom";
      }
    }
    var dur = spec.animation.duration || 0;
    var modes = spec.modes;
    // Läge, år, startår och dolda klasser följer med när kartan ritas om efter en storleksändring
    var behall = spec.keep_state || null;
    if (behall && behall.from_year != null && modes.forandring && modes.forandring.setFrom &&
        behall.from_year !== modes.forandring.from_year) modes.forandring.setFrom(behall.from_year);
    var T = spec.text, L = spec.legend, LB = spec.labels, TT = spec.tooltip, IA = spec.interactive;
    var fileName = vgrD3.slug((T.title && T.title.join(" ")) || "karta");
    var esc = vgrD3.esc;

    // -------------------------------------------------------------------------
    //  Grundstruktur
    // -------------------------------------------------------------------------
    var root = d3.select(el).style("width", W + "px");
    var controls = vgrD3.controls(el, font);
    var svg = root.append("svg").attr("class", "vgr-d3-svg")
      .attr("width", W).attr("height", H).attr("viewBox", "0 0 " + W + " " + H)
      .attr("role", "img").attr("aria-label", (T.title && T.title.join(" ")) || "Karta")
      .attr("font-family", font)
      .style("display", "block");
    // Responsivt: krymper sidan innan kartan hunnit ritas om skalas den med viewBox i stället
    // för att sticka ut
    if (RS.enabled) {
      root.style("max-width", "100%");
      svg.style("max-width", "100%").style("height", "auto");
    }
    var tip = vgrD3.tooltip(el, font);
    var tipId = null;   // regionen som tooltipen visar just nu

    var state = {
      mode: spec.default_mode,
      year: spec.default_year,
      hover: null,        // legendklass som hovras
      hidden: (behall && behall.hidden) || {},   // legendklasser som klickats bort
      selected: null,     // vald region/grupp (för klick-zoom)
      transform: d3.zoomIdentity
    };

    function M() { return modes[state.mode]; }
    function lookup(obj, id) {
      if (!obj) return null;
      var y = obj[state.year];
      if (!y) return null;
      var v = y[id];
      return v === undefined ? null : v;
    }
    function valueOf(id) { return lookup(M().values, id); }
    function classOf(id) { return lookup(M().classes, id); }
    function classKey(id) { var c = classOf(id); return c == null ? -1 : c; }
    function periodText() {
      return state.mode === "forandring" ? M().from_year + "–" + state.year : String(state.year);
    }

    // -------------------------------------------------------------------------
    //  Layout: rubriker, bildtext, legend och kartyta
    // -------------------------------------------------------------------------
    var m = spec.margin;
    var box = { x0: m.l, y0: m.t, x1: W - m.r, y1: H - m.b };

    var titleY = box.y0 + (T.title.length ? T.title_margin_top : 0);
    var titleH = T.title.length * T.title_size * 1.2;
    var subTop = titleY + titleH + (titleH ? 4 : 0);
    var subMax = 0;
    spec.mode_order.forEach(function (k) {
      Object.keys(modes[k].subtitles).forEach(function (y) { subMax = Math.max(subMax, modes[k].subtitles[y].length); });
    });
    var subH = subMax * T.subtitle_size * 1.25;
    var contentTop = subTop + subH + (titleH || subH ? 8 : 0);
    var capH = T.caption.length * T.caption_size * 1.2;
    var contentBottom = box.y1 - capH - (capH ? 6 : 0);

    // Legend: mät båda lägena så att kartan inte hoppar när man växlar
    var rowH = Math.max(L.key_h, L.text_size * 1.25) + 4;
    function legendEntries(mode) {
      var ms = modes[mode];
      var e = ms.class_labels.map(function (lab, i) { return { key: i, label: lab, color: ms.colors[i] }; });
      if (ms.has_na) e.push({ key: -1, label: spec.na_label, color: spec.na_color });
      return e;
    }
    function legendLayout(mode) {
      var ms = modes[mode], entries = legendEntries(mode);
      var tH = ms.legend_title ? L.text_size * 1.6 : 0;
      var tW = ms.legend_title ? vgrD3.measureText(svg, ms.legend_title, L.text_size, font) : 0;
      var widths = entries.map(function (e) { return L.key_w + 8 + vgrD3.measureText(svg, e.label, L.text_size, font); });
      if (L.position === "left" || L.position === "right") {
        entries.forEach(function (e, i) { e.x = 0; e.y = tH + i * rowH; });
        return { entries: entries, w: Math.max(tW, d3.max(widths) || 0) + 6, h: tH + entries.length * rowH };
      }
      var avail = box.x1 - box.x0, x = 0, y = tH, maxX = 0;
      entries.forEach(function (e, i) {
        var w = widths[i] + 18;
        if (x > 0 && x + w > avail) { x = 0; y += rowH; }
        e.x = x; e.y = y; x += w; maxX = Math.max(maxX, x - 18);
      });
      return { entries: entries, w: Math.max(maxX, tW), h: y + rowH };
    }
    var legendW = 0, legendH = 0, gap = 12;
    if (L.position !== "none") {
      spec.mode_order.forEach(function (k) {
        var l = legendLayout(k);
        legendW = Math.max(legendW, l.w);
        legendH = Math.max(legendH, l.h);
      });
    }

    var ext = { x0: box.x0, y0: contentTop, x1: box.x1, y1: contentBottom };
    if (L.position === "right") ext.x1 -= legendW + gap;
    if (L.position === "left") ext.x0 += legendW + gap;
    if (L.position === "top") ext.y0 += legendH + gap;
    if (L.position === "bottom") ext.y1 -= legendH + gap;

    // Etiketter utanför kartan: kartan krymps på bredden och etikettkolumner läggs på sidorna
    var mapExt = { x0: ext.x0, y0: ext.y0, x1: ext.x1, y1: ext.y1 };
    if (LB.show && LB.outside_map) {
      var inset = (ext.x1 - ext.x0) * LB.expand_factor / (1 + 2 * LB.expand_factor);
      mapExt.x0 += inset;
      mapExt.x1 -= inset;
    }

    // -------------------------------------------------------------------------
    //  Projektion
    // -------------------------------------------------------------------------
    var feats = spec.geo.features.map(function (f) { f.id = String(f.properties.id); return f; });
    var fitFeatures = feats.slice();
    if (spec.basemap && spec.basemap_fit) fitFeatures = fitFeatures.concat(spec.basemap.features);
    var proj = d3.geoIdentity().reflectY(true)
      .fitExtent([[mapExt.x0, mapExt.y0], [mapExt.x1, mapExt.y1]], { type: "FeatureCollection", features: fitFeatures });
    var path = d3.geoPath(proj);

    // fitExtent centrerar kartan i ytan; begränsas den av höjden (eller bredden) blir det ett glapp
    // mellan kartan och legenden. Legenden läggs i stället `gap` px från kartans verkliga kant, så att
    // kartan står kvar och det tomma delas lika på båda sidor (som ggplot). Etiketter utanför kartan
    // använder ytan mellan kartan och kanten, så då ligger legenden kvar vid ytans kant. Det som räknas
    // är allt som ritas (data, bakgrundskarta även utan basemap_fit, överlager) — fyller bakgrundskartan
    // ytan finns inget tomt att ta bort. Årsstämpeln ligger i övre vänstra hörnet av ytan: med legend till
    // vänster eller överst ligger legenden kvar där den låg, annars hamnar stämpeln på kartan.
    var extW0 = ext.x1 - ext.x0;   // årsstämpelns storlek räknas på ytan före krympningen
    var legendShift = { x: 0, y: 0, near: false };
    var drawn = feats.concat(spec.basemap ? spec.basemap.features : [], spec.overlay ? spec.overlay.geo.features : []);
    var stampInWay = spec.time.enabled && spec.time.label_show && (L.position === "left" || L.position === "top");
    if (!(LB.show && LB.outside_map) && !stampInWay && drawn.length) {
      var mb = path.bounds({ type: "FeatureCollection", features: drawn });
      if (isFinite(mb[0][0]) && isFinite(mb[1][0])) {
        legendShift.near = true;
        var slackX = Math.max(0, (ext.x1 - ext.x0) - (mb[1][0] - mb[0][0]));
        var slackY = Math.max(0, (ext.y1 - ext.y0) - (mb[1][1] - mb[0][1]));
        if (L.position === "right") legendShift.x = -slackX / 2;
        if (L.position === "left") legendShift.x = slackX / 2;
        if (L.position === "top") legendShift.y = slackY / 2;
        // (nederst behövs ingen förskjutning: legenden ritas från ext.y1, som krymps nedan)
        // Kartytan (klipp, zoom, etiketter) krymps lika mycket på legendens sida, så att inget (zoom,
        // bakgrundskarta utan basemap_fit, etiketter, bubblor) ritas under den flyttade legenden
        if (L.position === "right") ext.x1 -= slackX / 2;
        if (L.position === "left") ext.x0 += slackX / 2;
        if (L.position === "top") ext.y0 += slackY / 2;
        if (L.position === "bottom") ext.y1 -= slackY / 2;
      }
    }

    // -------------------------------------------------------------------------
    //  Lager
    // -------------------------------------------------------------------------
    svg.append("rect").attr("width", W).attr("height", H).attr("fill", "#ffffff");

    // Kartytan är en egen <svg> med samma koordinater som den yttre (viewBox = ytan), så att
    // allt utanför ytan klipps bort. clip-path ritades inte alltid om efter en zoomövergång i
    // Chrome, och kartan hamnade då ovanpå legenden.
    var mapArea = svg.append("svg").attr("class", "vgr-map-area")
      .attr("x", ext.x0).attr("y", ext.y0).attr("width", ext.x1 - ext.x0).attr("height", ext.y1 - ext.y0)
      .attr("viewBox", [ext.x0, ext.y0, ext.x1 - ext.x0, ext.y1 - ext.y0].join(" "))
      .attr("overflow", "hidden");
    var zoomRect = mapArea.append("rect")
      .attr("x", ext.x0).attr("y", ext.y0).attr("width", ext.x1 - ext.x0).attr("height", ext.y1 - ext.y0)
      .attr("fill", "#ffffff").attr("fill-opacity", 0);
    var zoomG = mapArea.append("g");
    // Linjebredderna sätts på grupperna och delas med zoomfaktorn (setStrokeScale), så att de
    // är lika tjocka på skärmen vid alla zoomnivåer. Det är mycket snabbare vid zoom än
    // vector-effect: non-scaling-stroke på varje område.
    var baseG = zoomG.append("g").attr("stroke-linejoin", "round");
    var dataG = zoomG.append("g").attr("stroke-linejoin", "round");
    var overlayG = zoomG.append("g").attr("stroke-linejoin", "round");
    function setStrokeScale(k) {
      baseG.attr("stroke-width", 1.42 / k);   // ggplot geom_sf standard (linewidth 0.5)
      dataG.attr("stroke-width", spec.data_line_size / k);
      if (spec.overlay) overlayG.attr("stroke-width", spec.overlay.line_size / k);
    }
    setStrokeScale(1);
    var hlPath = zoomG.append("path").attr("fill", "none").attr("stroke", "#263238").attr("stroke-width", 2.5)
      .attr("vector-effect", "non-scaling-stroke").attr("pointer-events", "none");
    var bubbleG = mapArea.append("g");
    var overlayLabelG = mapArea.append("g").attr("pointer-events", "none");
    var yearG = svg.append("g").attr("pointer-events", "none");
    // Etiketterna ligger i kartytan så att de klipps vid dess kant och inte hamnar över
    // legenden; etiketter utanför kartan (data_label_outside_map) ska däremot synas utanför
    var labelParent = LB.outside_map ? svg : mapArea;
    var lineG = labelParent.append("g").attr("pointer-events", "none");
    var labelG = labelParent.append("g").attr("pointer-events", "none");
    var legendG = svg.append("g");
    var headerG = svg.append("g");
    var subG = headerG.append("g");

    // Rubrik och bildtext
    var titleX = T.title_position === "panel" ? (mapExt.x0 + mapExt.x1) / 2 : (box.x0 + box.x1) / 2;
    vgrD3.textBlock(headerG, T.title, { x: titleX, y: titleY, size: T.title_size, font: font });
    vgrD3.textBlock(headerG, T.caption, { x: (box.x0 + box.x1) / 2, y: box.y1 - capH, size: T.caption_size, font: font });

    // Bakgrundskarta
    if (spec.basemap) {
      baseG.selectAll("path").data(spec.basemap.features).join("path")
        .attr("d", path)
        .attr("fill", spec.basemap_color)
        .attr("stroke", spec.basemap_color_line);
    }

    // Dataregioner
    var dataPaths = dataG.selectAll("path").data(feats).join("path")
      .attr("d", path)
      .attr("stroke", spec.data_color_line)
      .style("cursor", IA.zoom ? "pointer" : null)
      .on("mouseenter", function (event, d) {
        hlPath.attr("d", path(d));
        tipId = d.id;
        if (TT.show) tip.show(tooltipHtml(d.id), event);
      })
      .on("mousemove", function (event) { if (TT.show) tip.move(event); })
      .on("mouseleave", function () { hlPath.attr("d", null); tip.hide(); })
      .on("click", function (event, d) {
        event.stopPropagation();
        // Pekskärm: första trycket på ett område visar dess popup, nästa tryck på samma område
        // zoomar dit. Med mus visas popupen redan när pekaren är över området.
        if (lastPointer === "touch" && TT.show && touchTipId !== d.id) { showTouchTip(d); return; }
        touchTipId = null;
        if (IA.zoom) clickZoom(d);
      });

    // Senaste pekartyp ("mouse", "touch" eller "pen"), så att klick kan tolkas olika
    var lastPointer = "mouse", touchTipId = null;
    svg.on("pointerdown.vgrpekare", function (event) { lastPointer = event.pointerType || "mouse"; });
    function showTouchTip(d) {
      touchTipId = d.id;
      tipId = d.id;
      hlPath.attr("d", path(d));
      var a = anchorPx(d.id, false);
      if (a) tip.showAt(tooltipHtml(d.id), a[0], a[1] + svg.node().offsetTop);
    }
    // Tryck utanför områdena: stänger en öppen popup på pekskärm, annars återställs zoomen
    function closeTouchTip() {
      if (lastPointer !== "touch" || touchTipId == null) return false;
      touchTipId = null;
      tipId = null;
      hlPath.attr("d", null);
      tip.hide();
      return true;
    }

    // Överlagrade gränser (t.ex. kommunalförbund)
    if (spec.overlay) {
      overlayG.selectAll("path").data(spec.overlay.geo.features).join("path")
        .attr("d", path)
        .attr("fill", "none")
        .attr("stroke", spec.overlay.color)
        .attr("pointer-events", "none");
      overlayLabelG.selectAll("text").data(spec.overlay.labels).join("text")
        .attr("text-anchor", "middle").attr("dy", "0.35em")
        .attr("fill", spec.overlay.color)
        .attr("stroke", "#ffffff").attr("stroke-width", 3).attr("stroke-linejoin", "round").attr("paint-order", "stroke")
        .style("font-size", spec.overlay.label_size + "px").style("font-weight", "bold").style("font-family", font)
        .text(function (d) { return d.text; });
    }

    // -------------------------------------------------------------------------
    //  Färger och markering
    // -------------------------------------------------------------------------
    function fillOf(d) {
      var c = classOf(d.id);
      return c == null ? spec.na_color : M().colors[c];
    }
    function opacityOf(d) {
      var k = classKey(d.id);
      if (state.hidden[k]) return 0.12;
      if (state.hover != null && state.hover !== k) return 0.3;
      return 1;
    }
    function applyFills(animate) {
      // Utan animation (t.ex. legend-hover) avbryts en pågående övergång, annars skriver den över hovringen
      if (!(animate && dur)) dataPaths.interrupt();
      var sel = animate && dur ? dataPaths.transition().duration(dur) : dataPaths;
      sel.attr("fill", fillOf).attr("fill-opacity", opacityOf);
    }

    // -------------------------------------------------------------------------
    //  Tooltip
    // -------------------------------------------------------------------------
    // Lägets eget värde med lägets decimaler; från/till och bubblor med nivåns (TT.decimals)
    function fmtT(v, dec) { return vgrD3.fmt(v, dec == null ? TT.decimals : dec, LB.thousands === null ? null : " "); }

    function rankOf(id) {
      var y = M().values[state.year] || {};
      var v = y[id];
      var vals = Object.keys(y).map(function (k) { return y[k]; }).filter(function (x) { return x != null && !isNaN(x); });
      var better = vals.filter(function (x) { return TT.rank_order === "asc" ? x < v : x > v; }).length;
      return { rank: better + 1, n: vals.length };
    }

    function tooltipHtml(id) {
      var ms = M(), row = spec.rows[id] || { name: id };
      var v = valueOf(id), c = classOf(id);
      var h = "<div class='vgr-tt-title'>" + esc(row.name) + "</div>";
      if (spec.time.enabled) h += "<div class='vgr-tt-sub'>" + esc(periodText()) + "</div>";
      // Grupperad karta utan df_value har inget värde att visa — bara gruppen (raden nedan)
      if (ms.has_values !== false)
        h += vgrD3.tooltipRow(ms.value_label, v == null ? "Uppgift saknas" : fmtT(v, ms.decimals) + ms.unit,
          c == null ? spec.na_color : ms.colors[c]);
      if (state.mode === "forandring") {
        var from = lookup(ms.from, id), to = lookup(ms.to, id);
        h += vgrD3.tooltipRow(String(ms.from_year), from == null ? "–" : fmtT(from) + (ms.level_unit || ""));
        h += vgrD3.tooltipRow(String(state.year), to == null ? "–" : fmtT(to) + (ms.level_unit || ""));
      }
      if (TT.rank && v != null) {
        var r = rankOf(id);
        h += vgrD3.tooltipRow("Rangordning", "Plats " + r.rank + " av " + r.n);
      }
      if (c != null) h += vgrD3.tooltipRow(ms.class_row_label || "Klass", ms.class_labels[c],
        ms.has_values === false ? ms.colors[c] : undefined);
      else if (ms.has_values === false) h += vgrD3.tooltipRow(ms.class_row_label || "Klass", "Uppgift saknas", spec.na_color);
      if (spec.bubbles && spec.bubbles.in_tooltip) {
        var bv = (spec.bubbles.values[state.year] || {})[id];
        if (bv != null) h += vgrD3.tooltipRow(spec.bubbles.label, fmtT(bv, spec.bubbles.decimals), spec.bubbles.color);
      }
      TT.columns.forEach(function (col) {
        var yv = col.values[state.year];
        var val = yv ? yv[id] : null;
        if (val != null) h += vgrD3.tooltipRow(col.label, val);
      });
      return h;
    }

    // -------------------------------------------------------------------------
    //  Dataetiketter
    // -------------------------------------------------------------------------
    function anchorPx(id, withNudge) {
      var a = LB.anchors[id];
      if (!a) return null;
      var p = proj([a[0] + (withNudge ? LB.nudge_x : 0), a[1] + (withNudge ? LB.nudge_y : 0)]);
      return state.transform.apply(p);
    }

    function labelText(id) {
      var v = valueOf(id);
      var vt = v == null ? null : vgrD3.fmt(v, LB.decimals, LB.thousands);
      if (LB.prefix) {
        var pre = lookup(LB.prefix, id);
        if (pre == null) return null;
        return LB.show_value ? pre + LB.separator + (vt == null ? "–" : vt) : pre;
      }
      return vt;
    }

    // Flyttar isär överlappande etikettrutor och drar dem svagt tillbaka mot sin region
    function layoutRepel(items) {
      var sep = LB.force * 2;
      function pass(pull) {
        var moved = false;
        for (var i = 0; i < items.length; i++) {
          var a = items[i];
          for (var j = i + 1; j < items.length; j++) {
            var b = items[j];
            var ox = (a.w + b.w) / 2 + sep - Math.abs(a.x - b.x);
            var oy = (a.h + b.h) / 2 + sep - Math.abs(a.y - b.y);
            if (ox > 0 && oy > 0) {
              moved = true;
              if (ox < oy) {
                var sx = (a.x < b.x || (a.x === b.x && a.ay <= b.ay)) ? -1 : 1;
                a.x += sx * ox / 2; b.x -= sx * ox / 2;
              } else {
                var sy = (a.y < b.y || (a.y === b.y && a.ax <= b.ax)) ? -1 : 1;
                a.y += sy * oy / 2; b.y -= sy * oy / 2;
              }
            }
          }
        }
        items.forEach(function (d) {
          if (pull) { d.x += (d.ax - d.x) * 0.03; d.y += (d.ay - d.y) * 0.03; }
          d.x = clamp(d.x, ext.x0 + d.w / 2, ext.x1 - d.w / 2);
          d.y = clamp(d.y, ext.y0 + d.h / 2, ext.y1 - d.h / 2);
        });
        return moved;
      }
      for (var it = 0; it < 250; it++) if (!pass(true)) break;
      for (var it2 = 0; it2 < 40; it2++) if (!pass(false)) break;
      // Etiketter som fortfarande överlappar fler än max_overlaps andra döljs
      items.forEach(function (a) {
        var n = 0;
        items.forEach(function (b) {
          if (a !== b && Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2) n++;
        });
        a.hidden = n > LB.max_overlaps;
      });
    }

    // Etiketter i kolumner till vänster och höger om kartan, sorterade uppifrån och ned
    function layoutOutside(items) {
      var b = path.bounds({ type: "FeatureCollection", features: feats });
      var p0 = state.transform.apply(b[0]), p1 = state.transform.apply(b[1]);
      var dx0 = Math.max(ext.x0, p0[0]), dx1 = Math.min(ext.x1, p1[0]);
      var cx = (dx0 + dx1) / 2;
      var sides = [
        items.filter(function (d) { return d.ox < cx; }),
        items.filter(function (d) { return d.ox >= cx; })
      ];
      sides.forEach(function (side, k) {
        side.sort(function (a, c) { return a.oy - c.oy; });
        var y = ext.y0;
        side.forEach(function (d) { d.y = Math.max(d.oy, y + d.h / 2); y = d.y + d.h / 2 + 2; });
        var yb = ext.y1;
        for (var i = side.length - 1; i >= 0; i--) {
          var d = side[i];
          if (d.y + d.h / 2 > yb) d.y = yb - d.h / 2;
          yb = d.y - d.h / 2 - 2;
        }
        side.forEach(function (d) {
          d.x = k === 0 ? Math.max(ext.x0 + d.w / 2, dx0 - 14 - d.w / 2)
                        : Math.min(ext.x1 - d.w / 2, dx1 + 14 + d.w / 2);
        });
      });
    }

    // --- Etiketter som visas först vid tillräcklig zoom (data_label_zoom) ---
    // För varje etikett: minsta zoomfaktor k där den går fri från alla andra etiketter. Två
    // etiketter krockar om |dx|·k < B och |dy|·k < H, där B och H är etikettens bredd och höjd
    // i skärmpixlar minskade med den tillåtna överlappningen (data_label_zoom_overlap).
    var ZOOM_OVERLAP = LB.zoom_overlap == null ? 0.4 : LB.zoom_overlap, ZOOM_FREE_SHARE = 0.75;
    var freeAtZoom = null;
    function computeFreeAtZoom() {
      var widest = 0;
      LB.ids.forEach(function (id) {
        var t = labelText(id);
        if (t != null && String(t).length > widest) widest = String(t).length;
      });
      var sample = new Array(widest + 1).join("0");
      var pad = LB.box ? LB.size * 0.5 : 2;
      var B = (vgrD3.measureText(svg, sample, LB.size, font) + pad) * (1 - ZOOM_OVERLAP);
      var H = (LB.size * 1.2 + pad) * (1 - ZOOM_OVERLAP);
      var pts = LB.ids.map(function (id) {
        var a = LB.anchors[id];
        return a ? proj([a[0] + LB.nudge_x, a[1] + LB.nudge_y]) : null;
      });
      var idx = d3.range(pts.length).filter(function (i) { return pts[i]; });
      var qt = d3.quadtree().x(function (i) { return pts[i][0]; }).y(function (i) { return pts[i][1]; }).addAll(idx);
      var out = {};
      idx.forEach(function (i) {
        var x = pts[i][0], y = pts[i][1], need = 1;
        // Grannar längre bort än en etikettstorlek vid k = 1 kräver aldrig k > 1
        qt.visit(function (node, x0, y0, x1, y1) {
          if (x0 > x + B || x1 < x - B || y0 > y + H || y1 < y - H) return true;
          if (!node.length) {
            do {
              var j = node.data;
              if (j !== i) {
                var dx = Math.abs(pts[j][0] - x), dy = Math.abs(pts[j][1] - y);
                need = Math.max(need, Math.min(dx ? B / dx : Infinity, dy ? H / dy : Infinity));
              }
            } while ((node = node.next));
          }
          return false;
        });
        out[LB.ids[i]] = need;
      });
      return out;
    }

    // Textfärg: fast färg, eller "auto" = mörk på ljusa områden och vit på mörka
    function labelColor(d) {
      if (LB.color !== "auto") return LB.color;
      var c = classOf(d.id), bg = c == null ? spec.na_color : M().colors[c];
      return d3.hcl(bg).l > 58 ? "#0b1a2e" : "#ffffff";
    }

    function drawLabels() {
      labelG.selectAll("*").remove();
      lineG.selectAll("*").remove();
      if (!LB.show) return;
      var items = [];
      LB.ids.forEach(function (id) {
        if (state.hidden[classKey(id)]) return;
        var a = anchorPx(id, true), o = anchorPx(id, false);
        if (!a) return;
        if (!LB.outside_map && (o[0] < ext.x0 || o[0] > ext.x1 || o[1] < ext.y0 || o[1] > ext.y1)) return;
        items.push({ id: id, ax: a[0], ay: a[1], ox: o[0], oy: o[1], x: a[0], y: a[1] });
      });
      // Texten tas fram efter urvalet ovan: med data_label_zoom är det oftast bara en del
      // av etiketterna som behövs
      function withText(list) {
        return list.filter(function (d) {
          d.text = labelText(d.id);
          return d.text != null && d.text !== "";
        });
      }
      if (LB.zoom) {
        if (!freeAtZoom) freeAtZoom = computeFreeAtZoom();
        items = withText(items);
        var k = state.transform.k;
        var free = items.filter(function (d) { return freeAtZoom[d.id] <= k; }).length;
        if (!items.length || free / items.length < ZOOM_FREE_SHARE) {
          labelG.append("text")
            .attr("x", ext.x0 + 8).attr("y", ext.y1 - 8)
            .attr("fill", "#37474F")
            .attr("stroke", "#ffffff").attr("stroke-width", 3).attr("stroke-linejoin", "round")
            .attr("paint-order", "stroke")
            .style("font-size", Math.max(11, LB.size) + "px").style("font-family", font)
            .text("Zooma in för att visa värden");
          return;
        }
      } else {
        items = withText(items);
      }

      var pad = LB.box ? LB.size * 0.25 : 1;
      var g = labelG.selectAll("g").data(items).join("g");
      var rect = LB.box ? g.append("rect") : null;
      var txt = g.append("text")
        .attr("text-anchor", "middle").attr("dy", "0.35em")
        .attr("fill", labelColor)
        .style("font-size", LB.size + "px").style("font-family", font)
        .text(function (d) { return d.text; });
      if (LB.glow) {
        txt.attr("stroke", LB.glow_color).attr("stroke-width", LB.glow_width)
          .attr("stroke-linejoin", "round").attr("stroke-opacity", 0.85).attr("paint-order", "stroke");
      }
      txt.each(function (d) {
        d.w = vgrD3.nodeTextWidth(this) + 2 * pad;
        d.h = LB.size * 1.2 + 2 * pad;
      });
      if (rect) {
        rect.attr("x", function (d) { return -d.w / 2; }).attr("y", function (d) { return -d.h / 2; })
          .attr("width", function (d) { return d.w; }).attr("height", function (d) { return d.h; })
          .attr("rx", LB.size * 0.15)
          .attr("fill", LB.box_color).attr("fill-opacity", LB.box_alpha);
      }

      if (LB.outside_map) layoutOutside(items);
      else if (LB.repel) layoutRepel(items);

      g.attr("transform", function (d) { return "translate(" + d.x + "," + d.y + ")"; })
        .attr("display", function (d) { return d.hidden ? "none" : null; });

      if (LB.line && (LB.repel || LB.outside_map)) {
        var moved = items.filter(function (d) {
          return !d.hidden && (Math.abs(d.ox - d.x) > d.w / 2 || Math.abs(d.oy - d.y) > d.h / 2);
        });
        lineG.selectAll("line").data(moved).join("line")
          .attr("x1", function (d) { return d.ox; })
          .attr("y1", function (d) { return d.oy; })
          .attr("x2", function (d) { return clamp(d.ox, d.x - d.w / 2, d.x + d.w / 2); })
          .attr("y2", function (d) { return clamp(d.oy, d.y - d.h / 2, d.y + d.h / 2); })
          .attr("stroke", LB.line_color).attr("stroke-width", LB.line_size);
        lineG.selectAll("circle").data(moved).join("circle")
          .attr("cx", function (d) { return d.ox; }).attr("cy", function (d) { return d.oy; })
          .attr("r", Math.max(1, LB.line_size)).attr("fill", LB.line_color);
      }
    }

    // -------------------------------------------------------------------------
    //  Bubblor, överlagertexter och årtal (ritas i skärmkoordinater, skalas inte vid zoom)
    // -------------------------------------------------------------------------
    var bubbleR = spec.bubbles
      ? d3.scaleSqrt().domain([0, spec.bubbles.max_value || 1]).range([0, spec.bubbles.max_size]) : null;

    function drawBubbles(animate) {
      if (!spec.bubbles) return;
      var B = spec.bubbles, yv = B.values[state.year] || {};
      var data = Object.keys(LB.anchors).map(function (id) { return { id: id, v: yv[id] }; })
        .sort(function (a, b) { return Math.abs(b.v || 0) - Math.abs(a.v || 0); });
      var sel = bubbleG.selectAll("circle").data(data, function (d) { return d.id; }).join("circle")
        .attr("fill", B.color).attr("fill-opacity", B.alpha)
        .attr("stroke", B.line_color).attr("stroke-width", 1)
        .attr("pointer-events", "none")
        .attr("display", function (d) { return state.hidden[classKey(d.id)] ? "none" : null; });
      sel.order();
      positionUnscaled();
      (animate && dur ? sel.transition().duration(dur) : sel)
        .attr("r", function (d) { return d.v == null ? 0 : bubbleR(Math.abs(d.v)); });
    }

    function positionUnscaled() {
      bubbleG.selectAll("circle")
        .attr("cx", function (d) { return anchorPx(d.id, false)[0]; })
        .attr("cy", function (d) { return anchorPx(d.id, false)[1]; });
      overlayLabelG.selectAll("text")
        .attr("x", function (d) { return state.transform.apply(proj([d.x, d.y]))[0]; })
        .attr("y", function (d) { return state.transform.apply(proj([d.x, d.y]))[1]; });
    }

    var yearSize = Math.min(44, extW0 / 12) * (spec.text_scale || 1);   // text_scale som övrig text
    function drawYear() {
      yearG.selectAll("*").remove();
      if (!spec.time.enabled || !spec.time.label_show) return;
      yearG.append("text")
        .attr("x", ext.x0 + 4).attr("y", ext.y0 + yearSize)
        .attr("fill", "#37474F").attr("fill-opacity", 0.45)
        .style("font-size", yearSize + "px").style("font-weight", "bold").style("font-family", font)
        .text(periodText());
    }

    function drawSubtitle() {
      subG.selectAll("*").remove();
      var ms = M(), lines = ms.subtitles[state.year] || [];
      // Förändringsläget med ett annat startår än det R skrev in i underrubriken
      if (ms.subtitle_from != null && ms.subtitle_from !== ms.from_year) {
        var fran = ms.subtitle_from + "-" + state.year, till = ms.from_year + "-" + state.year;
        lines = lines.map(function (l) { return String(l).split(fran).join(till); });
      }
      vgrD3.textBlock(subG, lines, { x: titleX, y: subTop, size: T.subtitle_size, font: font, lineHeight: 1.25 });
    }

    // -------------------------------------------------------------------------
    //  Legend (hovra = markera klass, klicka = dölj/visa)
    // -------------------------------------------------------------------------
    function drawLegend() {
      legendG.selectAll("*").remove();
      if (L.position === "none") return;
      var lay = legendLayout(state.mode), ms = M();
      var lx, ly;
      if (L.position === "right") { lx = box.x1 - legendW; ly = (ext.y0 + ext.y1) / 2 - lay.h / 2; }
      else if (L.position === "left") { lx = box.x0; ly = (ext.y0 + ext.y1) / 2 - lay.h / 2; }
      else if (L.position === "top") { lx = (box.x0 + box.x1) / 2 - lay.w / 2; ly = contentTop; }
      else { lx = (box.x0 + box.x1) / 2 - lay.w / 2; ly = ext.y1 + gap; }
      lx += legendShift.x; ly += legendShift.y;
      // Vänster: legendens högra kant (utan de 6 px luft som lay.w har) mot kartan, som höger legends vänstra
      if (L.position === "left" && legendShift.near) lx += legendW - lay.w + 6;
      // Över: legendens nederkant mot kartan (legendH är det högsta läget; förändringsläget kan vara lägre)
      if (L.position === "top" && legendShift.near) ly += legendH - lay.h;

      var g = legendG.append("g").attr("transform", "translate(" + lx + "," + ly + ")");
      if (ms.legend_title) {
        g.append("text").attr("x", 0).attr("y", L.text_size)
          .style("font-size", L.text_size + "px").style("font-family", font)
          .text(ms.legend_title);
      }
      var item = g.selectAll("g.vgr-leg").data(lay.entries).join("g").attr("class", "vgr-leg")
        .attr("transform", function (d) { return "translate(" + d.x + "," + d.y + ")"; })
        .attr("opacity", function (d) { return state.hidden[d.key] ? 0.35 : 1; })
        .style("cursor", IA.legend ? "pointer" : null);
      var keyY = (rowH - 4) / 2;
      if (L.shape === "circle") {
        item.append("circle")
          .attr("cx", L.key_w / 2).attr("cy", keyY).attr("r", Math.min(L.key_w, L.key_h) * 0.42)
          .attr("fill", function (d) { return d.color; })
          .attr("stroke", "#000000").attr("stroke-width", 0.7);
      } else {
        item.append("rect")
          .attr("y", keyY - L.key_h / 2).attr("width", L.key_w).attr("height", L.key_h)
          .attr("fill", function (d) { return d.color; })
          .attr("stroke", spec.data_color_line).attr("stroke-width", 0.5);
      }
      item.append("text")
        .attr("x", L.key_w + 8).attr("y", keyY).attr("dy", "0.35em")
        .style("font-size", L.text_size + "px").style("font-family", font)
        .text(function (d) { return d.label; });
      if (IA.legend) {
        item.append("title").text("Klicka för att dölja/visa");
        item
          .on("mouseenter", function (event, d) { state.hover = d.key; applyFills(false); })
          .on("mouseleave", function () { state.hover = null; applyFills(false); })
          .on("click", function (event, d) {
            event.stopPropagation();
            state.hidden[d.key] = !state.hidden[d.key];
            update(false);
          });
      }
    }

    // -------------------------------------------------------------------------
    //  Zoom
    // -------------------------------------------------------------------------
    // Största zoom: så att även det minsta området kan fylla 85 % av kartytan (som klick-zoom
    // gör), minst 20 gånger och högst 1 000 gånger.
    var ew0 = ext.x1 - ext.x0, eh0 = ext.y1 - ext.y0;
    var maxZoom = 20;
    feats.forEach(function (f) {
      var b = path.bounds(f), s = Math.max((b[1][0] - b[0][0]) / ew0, (b[1][1] - b[0][1]) / eh0);
      if (s > 0 && isFinite(s)) maxZoom = Math.max(maxZoom, 0.85 / s);
    });
    maxZoom = Math.min(1000, maxZoom);

    var zoom = d3.zoom()
      .scaleExtent([1, maxZoom])
      .extent([[ext.x0, ext.y0], [ext.x1, ext.y1]])
      .translateExtent([[ext.x0, ext.y0], [ext.x1, ext.y1]])
      // Dubbelt så stora steg per hjulklick som d3:s standard, så att man når långt in utan att
      // behöva rulla länge
      .wheelDelta(function (event) {
        return -event.deltaY * (event.deltaMode === 1 ? 0.05 : event.deltaMode ? 1 : 0.002) * 2;
      })
      .on("start", function () { labelG.attr("opacity", 0); lineG.attr("opacity", 0); tip.hide(); })
      .on("zoom", function (event) {
        // Kartan flyttas eller zoomas: en popup som öppnats med ett tryck är inte längre aktuell
        // ("start" kommer redan när fingret sätts ned, även vid ett vanligt tryck)
        touchTipId = null;
        state.transform = event.transform;
        zoomG.attr("transform", event.transform);
        setStrokeScale(event.transform.k);
        positionUnscaled();
      })
      .on("end", function () { drawLabels(); labelG.attr("opacity", 1); lineG.attr("opacity", 1); });

    function boundsOf(ids) {
      var b = [[Infinity, Infinity], [-Infinity, -Infinity]];
      feats.forEach(function (f) {
        if (ids.indexOf(f.id) < 0) return;
        var fb = path.bounds(f);
        b = [[Math.min(b[0][0], fb[0][0]), Math.min(b[0][1], fb[0][1])],
             [Math.max(b[1][0], fb[1][0]), Math.max(b[1][1], fb[1][1])]];
      });
      return b;
    }
    function zoomToIds(ids) {
      var b = boundsOf(ids);
      if (!isFinite(b[0][0])) return;
      var dx = b[1][0] - b[0][0], dy = b[1][1] - b[0][1];
      var ew = ext.x1 - ext.x0, eh = ext.y1 - ext.y0;
      var k = Math.max(1, Math.min(maxZoom, 0.85 / Math.max(dx / ew, dy / eh)));
      var t = d3.zoomIdentity.translate((ext.x0 + ext.x1) / 2, (ext.y0 + ext.y1) / 2).scale(k)
        .translate(-(b[0][0] + b[1][0]) / 2, -(b[0][1] + b[1][1]) / 2);
      svg.transition().duration(dur).call(zoom.transform, t);
    }
    function clickZoom(d) {
      var ids = [d.id];
      if (spec.zoom_groups && spec.zoom_groups[d.id] != null) {
        var grp = spec.zoom_groups[d.id];
        ids = Object.keys(spec.zoom_groups).filter(function (k) { return spec.zoom_groups[k] === grp; });
      }
      var key = ids.join("|");
      if (state.selected === key) { resetZoom(); return; }
      state.selected = key;
      zoomToIds(ids);
    }
    function resetZoom() {
      state.selected = null;
      hlPath.attr("d", null);
      tip.hide();
      svg.transition().duration(dur).call(zoom.transform, d3.zoomIdentity);
    }
    function backgroundClick() { if (!closeTouchTip() && IA.zoom) resetZoom(); }
    if (IA.zoom) {
      svg.call(zoom).on("dblclick.zoom", null);
      zoomRect.on("click", backgroundClick);
      // Klick på bakgrundskartan (utanför dataregionerna) återställer också zoomen
      baseG.selectAll("path").style("cursor", "default").on("click", backgroundClick);
    } else {
      // Utan zoom stänger ett tryck utanför områdena bara popupen
      zoomRect.on("click", backgroundClick);
      baseG.selectAll("path").on("click", backgroundClick);
    }

    // -------------------------------------------------------------------------
    //  Kontroller: läge, tid, sök, återställ, export
    // -------------------------------------------------------------------------
    var slider = null, yearText = null, playBtn = null, timer = null;
    // Reglage med två handtag (spec.time.range): i förändringsläget väljs både startår och
    // slutår, i nivåläget bara år (det vänstra handtaget döljs). Båda handtagen går över
    // samma lista med alla år.
    var range = null;

    function syncSlider() {
      if (range) { syncRange(); return; }
      if (!slider) return;
      var ys = M().years;
      slider.attr("max", ys.length - 1).property("value", ys.indexOf(state.year));
      yearText.text(periodText());
    }
    function syncRange() {
      var ys = range.years, last = ys.length - 1, change = state.mode === "forandring";
      var hi = ys.indexOf(state.year), lo = change ? ys.indexOf(M().from_year) : 0;
      range.hi.property("value", hi);
      range.lo.property("value", lo).style("display", change ? null : "none")
        // Handtagen kan ligga nästan på varandra: det vänstra överst när det högra står längst till höger
        .style("z-index", hi === last ? 3 : 1);
      var pos = function (i) { return 7 + (last ? i / last : 0) * (range.width - 14); };
      range.fill.style("left", pos(lo) + "px").style("width", Math.max(0, pos(hi) - pos(lo)) + "px");
      yearText.text(periodText());
    }
    function setFrom(y) {
      stopPlay();
      M().setFrom(y);
      var ys = M().years;
      if (ys.indexOf(state.year) < 0) state.year = ys[ys.length - 1];
      syncSlider();
      update(true);
    }
    function setYear(y) {
      state.year = y;
      syncSlider();
      update(true);
    }
    function setMode(k) {
      if (k === state.mode) return;
      state.mode = k;
      state.hidden = {};
      state.hover = null;
      var ys = M().years;
      if (ys.indexOf(state.year) < 0) state.year = ys[ys.length - 1];
      syncSlider();
      update(true);
    }
    function stopPlay() {
      if (timer) { timer.stop(); timer = null; }
      if (playBtn) playBtn.text("▶");
    }
    function startPlay() {
      var ys = M().years;
      if (ys.indexOf(state.year) >= ys.length - 1) setYear(ys[0]);
      playBtn.text("❚❚");
      timer = d3.interval(function () {
        var ys2 = M().years, i = ys2.indexOf(state.year);
        if (i >= ys2.length - 1) { stopPlay(); return; }
        setYear(ys2[i + 1]);
      }, spec.animation.play_interval);
    }

    if (IA.mode_toggle) {
      vgrD3.buttonGroup(controls, spec.mode_order.map(function (k) { return { key: k, label: modes[k].label }; }),
        state.mode, setMode);
    }
    if (spec.time.enabled && spec.time.slider) {
      playBtn = vgrD3.button(controls, "▶", function () { if (timer) stopPlay(); else startPlay(); }, "Spela upp");
      if (spec.time.range && modes.forandring && modes.forandring.setFrom) {
        var rys = modes.forandring.all_years, rlast = rys.length - 1;
        var wrap = controls.append("span").attr("class", "vgr-range");
        wrap.append("span").attr("class", "vgr-range-track");
        range = { years: rys, width: 180, fill: wrap.append("span").attr("class", "vgr-range-fill") };
        range.lo = wrap.append("input").attr("type", "range").attr("min", 0).attr("max", rlast).attr("step", 1)
          .attr("aria-label", "Välj startår")
          .on("input", function () {
            var hi = rys.indexOf(state.year), i = Math.min(+this.value, hi - 1);
            this.value = i;
            if (rys[i] !== M().from_year) setFrom(rys[i]);
          });
        range.hi = wrap.append("input").attr("type", "range").attr("min", 0).attr("max", rlast).attr("step", 1)
          .attr("aria-label", "Välj år")
          .on("input", function () {
            stopPlay();
            var i = +this.value;
            if (state.mode === "forandring") i = Math.max(i, rys.indexOf(M().from_year) + 1);
            this.value = i;
            if (rys[i] !== state.year) setYear(rys[i]); else syncSlider();
          });
      } else {
        slider = controls.append("input").attr("type", "range").attr("min", 0).attr("step", 1)
          .attr("aria-label", "Välj år")
          .on("input", function () { stopPlay(); setYear(M().years[+this.value]); });
      }
      yearText = controls.append("span").attr("class", "vgr-year");
      syncSlider();
    }
    if (IA.search) {
      var listId = el.id + "-names";
      var names = Object.keys(spec.rows).map(function (k) { return String(spec.rows[k].name); }).sort(d3.ascending);
      // Sökrutan ligger i en egen span med ett kryss som tömmer den (webbläsarens eget kryss,
      // som bara finns i Chrome/Edge, döljs i CSS:en så att det ser likadant ut överallt)
      var sokWrap = controls.append("span").attr("class", "vgr-search");
      var input = sokWrap.append("input").attr("type", "search")
        .attr("placeholder", "Sök område…").attr("list", listId).attr("aria-label", "Sök område");
      var tomKnapp = sokWrap.append("button").attr("type", "button").attr("class", "vgr-search-clear")
        .attr("title", "Töm sökrutan").attr("aria-label", "Töm sökrutan").text("×").property("hidden", true);
      controls.append("datalist").attr("id", listId)
        .selectAll("option").data(names).join("option").attr("value", function (d) { return d; });
      var finnsNamn = {};
      names.forEach(function (n) { finnsNamn[n] = true; });
      var senastSokt = null;
      var visaKryss = function () { tomKnapp.property("hidden", !input.property("value")); };
      // Samma namn söks bara en gång när det väljs och rutan sedan lämnas ("change");
      // Enter söker alltid, t.ex. efter att man zoomat bort från området
      var sokEnGang = function (text) { if (text === senastSokt) return; senastSokt = text; searchFor(text); };
      input
        // Ett namn som väljs i listan, eller skrivs helt, zoomar direkt utan Enter. Ofullständiga
        // namn gör ingenting, så att kartan inte zoomar medan man skriver de första bokstäverna.
        .on("input", function () { visaKryss(); if (finnsNamn[this.value]) sokEnGang(this.value); })
        .on("change", function () { visaKryss(); sokEnGang(this.value); })
        .on("keydown", function (event) { if (event.key === "Enter") { senastSokt = this.value; searchFor(this.value); } });
      tomKnapp.on("click", function () {
        input.property("value", "");
        senastSokt = null;
        visaKryss();
        input.node().focus();
      });
    }
    if (IA.zoom) vgrD3.button(controls, "Återställ", resetZoom, "Återställ zoom och markering");
    controls.append("span").attr("class", "vgr-spacer");
    if (IA.export) vgrD3.exportButtons(controls, svg.node(), fileName);
    if (controls.selectAll("button,input").empty()) controls.remove();

    function searchFor(text) {
      var q = String(text || "").trim().toLowerCase();
      if (!q) return;
      var ids = Object.keys(spec.rows);
      var id = ids.find(function (k) { return String(spec.rows[k].name).toLowerCase() === q; }) ||
               ids.find(function (k) { return String(spec.rows[k].name).toLowerCase().indexOf(q) === 0; });
      if (!id) return;
      var f = feats.find(function (x) { return x.id === id; });
      if (IA.zoom) { state.selected = id; zoomToIds([id]); }
      setTimeout(function () {
        if (f) hlPath.attr("d", path(f));
        var a = anchorPx(id, false);
        tipId = id;
        if (TT.show && a) tip.showAt(tooltipHtml(id), a[0], a[1] + svg.node().offsetTop);
      }, (IA.zoom ? dur : 0) + 30);
    }

    // -------------------------------------------------------------------------
    //  Uppdatering
    // -------------------------------------------------------------------------
    function update(animate) {
      applyFills(animate);
      drawSubtitle();
      drawYear();
      drawLegend();
      drawBubbles(animate);
      drawLabels();
      if (TT.show && tipId != null) tip.refresh(tooltipHtml(tipId));
    }
    update(false);
    positionUnscaled();

    // Responsiv layout: rita om kartan när den tillgängliga bredden ändras (fönstret ändrar
    // storlek, mobilen vänds). Spec:en läses om från sidan, eftersom den packas upp i
    // expandCompact, och läge, år, startår och dolda klasser följer med. Zoomen börjar om.
    if (RS.enabled && typeof ResizeObserver !== "undefined" && el.parentNode) {
      if (el.__vgrResize) el.__vgrResize.disconnect();
      var omritning = null;
      var ro = new ResizeObserver(function () {
        var b = Math.floor(availableWidth(el));
        if (!b) return;   // dold (t.ex. en reveal.js-bild som inte visas)
        if (Math.abs(Math.min(W0, b) - W) < 2) return;
        // Tillbaka till bredden före förra omritningen strax efter den: den nya kartans höjd har
        // troligen tagit fram eller tagit bort rullningslisten. Rita inte om igen (ingen pendling).
        var f = el.__vgrForra;
        if (f && Math.abs(Math.min(W0, b) - f.bredd) < 2 && Date.now() - f.tid < 1500) return;
        clearTimeout(omritning);
        omritning = setTimeout(function () {
          var specEl = document.getElementById(el.id + "-spec");
          if (!specEl) return;
          ro.disconnect();
          stopPlay();
          var ny = JSON.parse(specEl.textContent);
          // Bredden mäts medan den gamla kartan finns kvar, och höjden hålls under omritningen.
          // Annars kan sidan bli kortare när innehållet tas bort, så att rullningslisten försvinner,
          // bredden ändras och kartan ritas om i en evig loop.
          var bNu = Math.floor(availableWidth(el));
          if (!bNu) { ro.observe(el.parentNode); return; }
          ny.avail_width = bNu;
          el.__vgrForra = { bredd: W, tid: Date.now() };
          el.style.minHeight = el.offsetHeight + "px";
          ny.default_mode = state.mode;
          ny.default_year = state.year;
          ny.keep_state = {
            from_year: state.mode === "forandring" && modes.forandring ? modes.forandring.from_year : null,
            hidden: state.hidden
          };
          d3.select(el).selectAll("*").remove();
          el.style.width = "";
          vgrD3.renderers.karta(el, ny);
          el.style.minHeight = "";
        }, 200);
      });
      ro.observe(el.parentNode);
      el.__vgrResize = ro;
    }
  };
})();
