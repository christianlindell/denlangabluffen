/* vgr_D3 — stapeldiagram (func_d3_stapeldiagram / func_d3_barchart).
 *
 * Staplarna kopplas till data med nyckeln facett|x|grupp så att växling mellan grupperad,
 * staplad och 100 %, sortering och filterbyte animeras. Axlar, rutnät, legend och etiketter
 * ritas om vid varje uppdatering. "Kategori" = x-variabeln, "värde" = y-variabeln — med
 * horizontal = TRUE hamnar kategorierna på den lodräta axeln (som coord_flip i ggplot2).
 */
(function () {
  "use strict";
  var vgrD3 = window.vgrD3;
  function pt(v) { return v * 96 / 72; }
  var LINES = pt(11 * 1.2);

  vgrD3.renderers.stapeldiagram = function (el, spec) {
    var W = spec.width, H = spec.height, font = spec.font;
    var T = spec.text, X = spec.x, Y = spec.y, F = spec.facets, L = spec.legend, LB = spec.labels;
    var TT = spec.tooltip, IA = spec.interactive, HL = spec.highlight, REF = spec.reference;
    var HOR = spec.horizontal;
    var dur = spec.animation.duration || 0;
    var esc = vgrD3.esc;
    var fileName = vgrD3.slug((T.title && T.title.join(" ")) || "stapeldiagram");

    var root = d3.select(el).style("max-width", W + "px");
    var controls = vgrD3.controls(el, font);
    var svg = root.append("svg").attr("class", "vgr-d3-svg")
      .attr("width", W).attr("height", H).attr("viewBox", "0 0 " + W + " " + H)
      .attr("role", "img").attr("aria-label", (T.title && T.title.join(" ")) || "Stapeldiagram")
      .attr("font-family", font)
      .style("width", "100%").style("height", "auto").style("display", "block");
    var tip = vgrD3.tooltip(el, font);

    if (spec.empty) {
      svg.append("text").attr("x", W / 2).attr("y", H / 2).attr("text-anchor", "middle")
        .style("font-size", (18 * (spec.text_scale || 1)) + "px").text("Inga data att visa");
      return;
    }

    var groups = spec.groups, gIndex = {}, groupByKey = {};
    groups.forEach(function (g, i) { gIndex[g.key] = i; groupByKey[g.key] = g; });
    var hlSet = {};
    HL.x.forEach(function (x) { hlSet[x] = true; });
    var hlEnc = {};
    (HL.x_enc || []).forEach(function (x) { hlEnc[x] = true; });   // datum/tal-x i JS-kodning
    // Referensmarkörer ritas bara på ostaplade staplar; legend och tooltip följer det
    function refVisible() { return REF.enabled && (!spec.has_groups || state.type === "grouped"); }
    var hasHighlight = HL.x.length > 0;
    var hasFacets = !(F.levels.length === 1 && F.levels[0] === "__alla");
    // sharedY = gemensam värdeaxel, sharedX = gemensam kategoriaxel. På liggande staplar (coord_flip i originalet)
    // gäller facet_scales de visade axlarna: "free_x" frigör värdeaxeln och "free_y" kategoriaxeln
    var sharedY = !hasFacets || F.scales === "fixed" || F.scales === (HOR ? "free_y" : "free_x");
    var sharedX = !hasFacets || F.scales === "fixed" || F.scales === (HOR ? "free_x" : "free_y");

    var state = { type: spec.bar_type, sort: IA.sort_start, filter: spec.filter.default,
                  hidden: {}, hoverGroup: null, first: true };

    function rowsFor(k) {
      return spec.rows.filter(function (r) { return r.k === k && !state.hidden[r.g] && r.v != null; });
    }
    // Nyckeldelar skiljs med ett tecken som inte förekommer i namn (ett "|" i ett kommunnamn gav krockar)
    var SEP = "";
    function barKey(r) { return r.f + SEP + r.x + SEP + r.g; }
    function isHighlighted(r) { return hlSet[r.xt] === true || hlSet[String(r.x)] === true; }

    // -------------------------------------------------------------------------
    //  Stapelgeometri i dataenheter: grupperad (dodge), staplad (stack), 100 % (fill)
    // -------------------------------------------------------------------------
    function computeBars(rows, type) {
      var out = [];
      d3.group(rows, function (r) { return r.f; }, function (r) { return r.x; }).forEach(function (byX, f) {
        byX.forEach(function (list, x) {
          list = list.slice().sort(function (a, b) { return gIndex[a.g] - gIndex[b.g]; });
          var totalAll = d3.sum(list, function (r) { return r.v; });
          var totalAbs = d3.sum(list, function (r) { return Math.abs(r.v); });
          if (type === "grouped" || !spec.has_groups) {
            var n = list.length;
            list.forEach(function (r, i) {
              var off = spec.has_groups ? (i - (n - 1) / 2) * spec.bar_width / n : 0;
              out.push({ r: r, key: barKey(r), f: f, x: x, g: r.g, v: r.v, v0: 0, v1: r.v,
                         off: off, w: spec.bar_width / (spec.has_groups ? n : 1), total: totalAll, stacked: false });
            });
          } else {
            // ggplot2 staplar i omvänd nivåordning: sista gruppen närmast noll
            var pos = 0, neg = 0;
            // Stapelns ändar (positiva delar uppåt från 0, negativa nedåt) — "outside"-etiketten läggs bortom
            // änden i summans riktning, som func_graf_barchart (nettosumman ligger inne i stapeln vid negativa delar)
            // 100 %: positiva och negativa delar normaliseras var för sig (0..1 resp. -1..0), som ggplots position_fill
            var posSum = 0, negSum = 0;
            list.forEach(function (r) { if (r.v >= 0) posSum += r.v; else negSum += r.v; });
            function plotV(r) {
              if (type !== "filled") return r.v;
              return r.v >= 0 ? (posSum ? r.v / posSum : 0) : (negSum ? r.v / Math.abs(negSum) : 0);
            }
            var endPos = type === "filled" ? (posSum > 0 ? 1 : 0) : posSum;
            var endNeg = type === "filled" ? (negSum < 0 ? -1 : 0) : negSum;
            list.slice().reverse().forEach(function (r) {
              var v = plotV(r);
              var a, b;
              if (v >= 0) { a = pos; b = pos + v; pos = b; } else { a = neg; b = neg + v; neg = b; }
              out.push({ r: r, key: barKey(r), f: f, x: x, g: r.g, v: r.v, v0: a, v1: b, off: 0,
                         w: spec.bar_width, total: type === "filled" ? 1 : totalAll,
                         end: totalAll >= 0 ? endPos : endNeg,   // stapelns ände i summans riktning
                         sgn: totalAll >= 0 ? 1 : -1,             // summans tecken (total är 1 i 100 %-läget)
                         rawTotal: totalAll,                      // stapelns summa (visas av "outside"-etiketten)
                         share: totalAbs ? r.v / totalAbs : null, stacked: true });
            });
          }
        });
      });
      return out;
    }

    // -------------------------------------------------------------------------
    //  Kategorier och sortering
    // -------------------------------------------------------------------------
    function categoriesFor(rows) {
      if (X.type !== "discrete") return null;
      var present = {};
      rows.forEach(function (r) { present[r.x] = true; });
      var cats = X.levels.filter(function (c) { return present[c]; });
      if (state.sort === "value_desc" || state.sort === "value_asc") {
        var sums = {}, first = {};
        rows.forEach(function (r) {
          sums[r.x] = (sums[r.x] || 0) + r.v;
          first[r.x] = Math.min(first[r.x] == null ? Infinity : first[r.x], r.o);
        });
        var sign = state.sort === "value_desc" ? -1 : 1;
        // Lika värden behåller dataordningen (som order() i func_graf_barchart)
        cats.sort(function (a, b) { return sign * (sums[a] - sums[b]) || first[a] - first[b]; });
      } else if (state.sort === "name_asc" || state.sort === "name_desc") {
        cats.sort(function (a, b) { return a.localeCompare(b, "sv"); });
        if (state.sort === "name_desc") cats.reverse();
      }
      return cats;
    }

    function makeCatScale(cats, r0, r1, needs) {
      var s;
      if (cats) {
        // Diskret skala: position 1..n. ggplot2 utökar 1..n med 5 % och tar sedan med stapelbredden
        var n = cats.length, idx = {};
        cats.forEach(function (c, i) { idx[c] = i + 1; });
        var half = spec.bar_width / 2, ext = 0.05 * Math.max(n - 1, 0);
        var lo = Math.min(1 - ext, 1 - half), hi = Math.max(n + ext, n + half);
        // Etiketter utan repel ligger mitt på sin stapel: skalan breddas så att halva den uppmätta etiketten
        // (needs: {x, off, half px}) ryms utanför den yttersta (som func_graf_barchart sedan 2026-10-09). Staplarna
        // behåller minst halva panelen; räcker det inte flyttas etiketten in i panelen när den ritas
        // (needs: {x, off} vid första/sista kategorin, samma half för båda — se catLabel i update())
        if (needs && needs.length) {
          var pos = needs.map(function (d) { return idx[d.x] + d.off; }).filter(function (p) { return !isNaN(p); });
          if (pos.length) {
            var padded = vgrD3.padDomain([lo, hi], d3.min(pos), d3.max(pos), needs[0].half, needs[0].half, Math.abs(r1 - r0));
            lo = padded[0]; hi = padded[1];
          }
        }
        s = d3.scaleLinear().domain([lo, hi]).range([r0, r1]);
        s.pos = function (x) { return idx[x]; };
        s.cats = cats;
      } else {
        s = d3.scaleLinear().domain(X.domain).range([r0, r1]);
        s.pos = function (x) { return x; };
      }
      s.unit = Math.abs(s(1) - s(0));
      return s;
    }

    // -------------------------------------------------------------------------
    //  Värdeaxel
    // -------------------------------------------------------------------------
    function autoNudge(bars) {
      if (LB.position !== "outside" || LB.nudge_y !== 0 || !bars.length) return 0;
      // 3 % av spannet från 0 till etiketternas ändar (staplade: stapelns ände i plottenheter) — med 0 blir
      // avståndet inte noll när alla ändar är lika (100 % = 1, en enda stapel), som func_graf_barchart
      var vals = bars.map(function (b) { return b.stacked ? b.end : b.v; }).concat([0]);
      return (d3.max(vals) - d3.min(vals)) * 0.03;
    }
    function labelValue(b, an) {
      var ny = LB.nudge_y, pos = LB.position;
      if (b.stacked) {
        var seg = b.v1 - b.v0, top = b.v1, mid = (b.v0 + b.v1) / 2;
        if (pos === "outside") return (b.sgn >= 0 ? b.end + Math.abs(an) : b.end - Math.abs(an)) + ny;
        if (pos === "top") return top - seg * 0.05 + ny;
        if (pos === "middle") return mid + ny;
        if (pos === "inside") return top - seg * 0.10 + ny;
        return b.total + ny;
      }
      var v = b.v1;
      if (pos === "outside") return (v >= 0 ? v + Math.abs(an) : v - Math.abs(an)) + ny;
      if (pos === "top") return v * 0.95 + ny;
      if (pos === "middle") return v / 2 + ny;
      if (pos === "inside") return v * 0.90 + ny;
      return v + ny;
    }
    function labelBars(bars) {
      if (!LB.show) return [];
      // Nycklarna gäller per filtervärde (b.r.k), så att staplar från flera filtervärden (interactive_filter_same_y)
      // får rätt urval när axeln räknas
      var keys = {}, tkeys = {}, seen = {};
      LB.keys.forEach(function (k) { keys[k.k + SEP + k.f + SEP + k.x + SEP + k.g] = true; });
      // Staplade/100 % + "outside": en etikett per stapel med stapelns summa, urvalet (first/last, skip, filter)
      // gjort i R som i func_graf_barchart — annars hamnar alla segmentens etiketter på samma punkt
      (LB.total_keys || []).forEach(function (k) { tkeys[k.k + SEP + k.f + SEP + k.x] = true; });
      return bars.filter(function (b) {
        if (b.stacked && LB.position === "outside") {
          var t = b.r.k + SEP + b.f + SEP + b.x;
          if (!tkeys[t] || seen[t]) return false;
          seen[t] = true; return true;
        }
        return keys[b.r.k + SEP + b.key];
      });
    }

    function valueDomain(bars) {
      var lo = 0, hi = 0;
      bars.forEach(function (b) { lo = Math.min(lo, b.v0, b.v1); hi = Math.max(hi, b.v0, b.v1); });
      if (state.type !== "filled" || !spec.has_groups) {
        bars.forEach(function (b) {
          if (REF.enabled && b.r.ref != null && !b.stacked) { lo = Math.min(lo, b.r.ref); hi = Math.max(hi, b.r.ref); }
        });
        spec.ref.y.forEach(function (v) { lo = Math.min(lo, v); hi = Math.max(hi, v); });
      }
      var an = autoNudge(labelBars(bars));
      labelBars(bars).forEach(function (b) { var v = labelValue(b, an); lo = Math.min(lo, v); hi = Math.max(hi, v); });
      if (state.type === spec.bar_type) {
        if (Y.min != null) lo = Y.min;
        if (Y.max != null) hi = Y.max;
      }
      if (lo === hi) hi = lo + 1;
      var span = hi - lo;
      return [lo - span * Y.expand[0], hi + span * Y.expand[1]];
    }

    var isFilled = function () { return state.type === "filled" && spec.has_groups; };
    function valueTicks(vs) {
      var d = vs.domain();
      var ticks = Y.breaks ? Y.breaks.filter(function (v) { return v >= Math.min(d[0], d[1]) && v <= Math.max(d[0], d[1]); })
                           : vs.ticks(Y.auto ? Y.n_breaks : 5);
      var step = ticks.length > 1 ? Math.abs(ticks[1] - ticks[0]) : 1;
      if (isFilled()) {
        // aldrig utanför ±100 % — negativa delar ritas ned till -100 % (som ggplots position_fill)
        ticks = ticks.filter(function (t) { return t >= -1 - 1e-9 && t <= 1 + 1e-9; });
        var pdec = Math.max(0, d3.precisionFixed(step * 100));
        return ticks.map(function (t) { return { v: t, label: vgrD3.fmt(t * 100, pdec, null) + "%" }; });
      }
      var dec = d3.precisionFixed(step);
      return ticks.map(function (t) { return { v: t, label: vgrD3.fmt(t, dec, " ") }; });
    }

    // -------------------------------------------------------------------------
    //  Textformat för etiketter och tooltip
    // -------------------------------------------------------------------------
    // Exakt data_label_decimals ("5,0" bredvid "6,1"), som format(round(x, d), nsmall = d) i func_graf_barchart.
    // Före 2026-10-07 togs avslutande nollor bort ("5"); data_label_decimals = 0 ger heltal.
    function fmtLabel(v, dec) {
      return vgrD3.fmt(v, dec, " ");
    }
    function wrapText(text, width) {
      if (!width) return text;
      // Bara vanliga mellanslag bryter — tusentalsavgränsaren är ett hårt mellanslag (U+00A0), så ett tal
      // som "2 972" hålls ihop (\s skulle matcha det och dela talet; stringr::str_wrap gör inte så)
      var words = String(text).split(/[ \t\r\n]+/), lines = [], cur = "";
      words.forEach(function (w) {
        if (cur && (cur + " " + w).length > width) { lines.push(cur); cur = w; }
        else cur = cur ? cur + " " + w : w;
      });
      if (cur) lines.push(cur);
      return lines.join("\n");
    }
    function isTotalLabel(b) { return b.stacked && LB.position === "outside"; }
    function labelText(b) {
      var val = isTotalLabel(b) ? b.rawTotal : b.v;   // stapelns summa för "outside" på staplade staplar
      var base = LB.format === "percentage" ? fmtLabel(100 * val, LB.decimals) + "%" : fmtLabel(val, LB.decimals);
      if (LB.format === "x_y") base = b.r.xt + LB.separator + base;
      var text = LB.show_group && !isTotalLabel(b) ? groupByKey[b.g].label + LB.separator + base : base;
      // Radbryts bara etiketter med text (x_y eller gruppnamn först), som func_graf_barchart
      var hasText = (LB.format !== "number" && LB.format !== "percentage") || (LB.show_group && !isTotalLabel(b));
      if (LB.width && hasText) text = wrapText(text, LB.width);
      return text;
    }
    function fmtTip(v) { return vgrD3.fmt(v, TT.decimals, " ") + TT.unit; }

    function barFill(b) {
      if (!spec.has_groups) {
        if (hasHighlight && HL.color && isHighlighted(b.r)) return HL.color;
        if (spec.color_negative && b.v < 0) return spec.color_negative;
      }
      return groupByKey[b.g].color;
    }
    function barOpacity(b) {
      var o = 1;
      if (hasHighlight && !isHighlighted(b.r)) o = HL.other_alpha;
      if (state.hoverGroup != null && state.hoverGroup !== b.g) o *= 0.3;
      return o;
    }

    // -------------------------------------------------------------------------
    //  Fasta lager
    // -------------------------------------------------------------------------
    svg.append("rect").attr("width", W).attr("height", H).attr("fill", "#ffffff");
    var mT = hasFacets ? 15 : 10, mR = hasFacets ? 15 : 10, mL = hasFacets ? 15 : 10;
    var mB = (X.angle > 0 ? 25 : 10) + (hasFacets ? 5 : 0);
    var box = { x0: pt(mL), y0: pt(mT), x1: W - pt(mR), y1: H - pt(mB) };
    var headerH = 0;
    var th = vgrD3.textBlock(svg, T.title, { x: box.x0, y: box.y0, size: T.title_size, font: font, anchor: "start", lineHeight: 1.1 });
    headerH += th + (th ? pt(5) : 0);
    var sh = vgrD3.textBlock(svg, T.subtitle, { x: box.x0, y: box.y0 + headerH, size: T.subtitle_size, font: font, anchor: "start" });
    headerH += sh + (sh ? pt(5) : 0);
    if (th || sh) headerH += pt(5);
    var capH = T.caption.length * T.caption_size * 1.2;

    var dynG = svg.append("g");        // legend, axeltitlar, bildtext — ritas om
    var panelsG = svg.append("g");
    var hoverG = svg.append("g").attr("pointer-events", "none");

    // -------------------------------------------------------------------------
    //  Legend
    // -------------------------------------------------------------------------
    function drawLegend(area) {
      var entries = spec.has_groups ? groups.map(function (g) { return { g: g, kind: "group" }; }) : [];
      if (refVisible()) entries.push({ g: { key: "__ref", label: REF.label, color: REF.color }, kind: "ref" });
      if (L.position === "none" || !entries.length) return;
      var key = pt(17.28), rowH = Math.max(L.text_size * 1.3, key + 2);
      var hasTitle = !!(L.title && spec.has_groups);
      var vertical = L.position === "left" || L.position === "right";
      entries.forEach(function (e) { e.w = key + 6 + vgrD3.measureText(svg, e.g.label, L.text_size, font); });
      var titleW = hasTitle ? vgrD3.measureText(svg, L.title, L.title_size, font) : 0;
      // Lodrät legend: titel ovanför. Vågrät legend: titel till vänster på första raden (som ggplot2)
      var titleH = hasTitle && vertical ? L.title_size * 1.6 : 0;
      var lw, lh;
      if (vertical) {
        entries.forEach(function (e, i) { e.x = 0; e.y = titleH + i * rowH; });
        lw = Math.max(titleW, d3.max(entries, function (e) { return e.w; })) + 8;
        lh = titleH + entries.length * rowH;
      } else {
        var startX = hasTitle ? titleW + 10 : 0;
        var avail = area.x1 - area.x0, x = startX, y = 0, maxX = 0;
        entries.forEach(function (e) {
          if (x > startX && x + e.w > avail) { x = startX; y += rowH; }
          e.x = x; e.y = y; x += e.w + 16; maxX = Math.max(maxX, x - 16);
        });
        lw = maxX; lh = y + rowH;
      }
      var lx, ly, gap = pt(11);
      if (L.position === "right") { lx = area.x1 - lw; ly = (area.y0 + area.y1) / 2 - lh / 2; area.x1 -= lw + gap; }
      else if (L.position === "left") { lx = area.x0; ly = (area.y0 + area.y1) / 2 - lh / 2; area.x0 += lw + gap; }
      else if (L.position === "top") { lx = (area.x0 + area.x1) / 2 - lw / 2; ly = area.y0; area.y0 += lh + gap; }
      else { lx = (area.x0 + area.x1) / 2 - lw / 2; ly = area.y1 - lh; area.y1 -= lh + gap; }

      var lg = dynG.append("g").attr("transform", "translate(" + lx + "," + ly + ")");
      if (hasTitle) {
        lg.append("text").attr("y", vertical ? L.title_size : rowH / 2).attr("dy", vertical ? null : "0.35em")
          .style("font-size", L.title_size + "px").style("font-family", font).text(L.title);
      }
      var item = lg.selectAll("g.vgr-leg").data(entries).join("g").attr("class", "vgr-leg")
        .attr("transform", function (e) { return "translate(" + e.x + "," + e.y + ")"; })
        .attr("opacity", function (e) { return state.hidden[e.g.key] ? 0.35 : 1; })
        .style("cursor", function (e) { return IA.legend && e.kind === "group" ? "pointer" : null; });
      item.append("rect").attr("width", function (e) { return e.w; }).attr("height", rowH).attr("fill", "#ffffff").attr("fill-opacity", 0);
      item.filter(function (e) { return e.kind === "group"; }).append("rect")
        .attr("y", (rowH - key) / 2).attr("width", key).attr("height", key).attr("fill", function (e) { return e.g.color; })
        .attr("stroke", (spec.bar_line || {}).color || "none").attr("stroke-width", (spec.bar_line || {}).color ? spec.bar_line.width : 0);   // som staplarna
      item.filter(function (e) { return e.kind === "ref"; }).append("line")
        .attr("x1", 2).attr("x2", key - 2).attr("y1", rowH / 2).attr("y2", rowH / 2)
        .attr("stroke", REF.color).attr("stroke-width", 3);
      item.append("text").attr("x", key + 6).attr("y", rowH / 2).attr("dy", "0.35em")
        .style("font-size", L.text_size + "px").style("font-family", font).text(function (e) { return e.g.label; });
      if (IA.legend) {
        var gi = item.filter(function (e) { return e.kind === "group"; });
        gi.append("title").text("Klicka för att dölja/visa");
        gi.on("mouseenter", function (event, e) { state.hoverGroup = e.g.key; panelsG.selectAll("rect.vgr-bar").attr("opacity", function (b) { return barOpacity(b); }); })
          .on("mouseleave", function () { state.hoverGroup = null; panelsG.selectAll("rect.vgr-bar").attr("opacity", function (b) { return barOpacity(b); }); })
          .on("click", function (event, e) {
            if (state.hidden[e.g.key]) delete state.hidden[e.g.key]; else state.hidden[e.g.key] = true;
            if (Object.keys(state.hidden).length >= groups.length) delete state.hidden[e.g.key];   // minst en grupp syns
            update(true);
          });
      }
    }

    // -------------------------------------------------------------------------
    //  Uppdatering
    // -------------------------------------------------------------------------
    function update(animate) {
      var t = animate && dur > 0 ? dur : 0;
      dynG.selectAll("*").remove();
      hoverG.selectAll("*").remove();
      tip.hide();

      var rows = rowsFor(state.filter);
      var bars = computeBars(rows, state.type);

      // Staplarna för alla filtervärden — byggs högst en gång per ritning, och bara när de behövs
      var allBars = null;
      function allFilterBars() {
        if (allBars) return allBars;
        if (!spec.filter.enabled) return (allBars = bars);
        allBars = [];
        spec.filter.values.forEach(function (k) { allBars = allBars.concat(computeBars(rowsFor(k), state.type)); });
        return allBars;
      }
      // Värdeaxelns omfång: alla filtervärden (fast axel) eller bara det valda
      var domainBars = spec.filter.enabled && spec.filter.same_y ? allFilterBars() : bars;

      // Plats längs kategoriaxeln för stående staplars etiketter utan repel (som func_graf_barchart): den bredaste
      // etiketten i hela diagrammet — alla filtervärden, så att staplarna inte byter bredd eller läge när filtret,
      // animationen eller sorteringen ändras — och den största förskjutningen åt sidan (dodge/nudge_x), vid
      // första och sista kategorin. Beror bara på staplingstypen och dolda grupper, så mätningen sparas och görs
      // om bara när någon av dem ändras (inte vid varje filterbyte eller uppspelningsruta)
      var repelOn = LB.repel && !(spec.has_groups && state.type !== "grouped");   // repel gäller inte staplade staplar
      // (SEP som i barKey, så att ett gruppnamn med "|" inte kan krocka)
      var catKey = state.type + SEP + Object.keys(state.hidden).filter(function (g) { return state.hidden[g]; }).sort().join(SEP);
      if (state.catLabelKey !== catKey) {
        var cl = { half: 0, offMin: 0, offMax: 0 };
        if (!HOR && LB.show && !repelOn) {
          var pad = LB.box ? LB.size * 0.25 : 1, dodgedN = spec.has_groups && state.type === "grouped";
          labelBars(allFilterBars()).forEach(function (b) {
            var w = d3.max(String(labelText(b)).split("\n"), function (t) { return vgrD3.measureText(svg, t, LB.size, font); }) + 2 * pad;
            var off = b.off + (!dodgedN ? LB.nudge_x : 0);
            cl.half = Math.max(cl.half, w / 2 + pt(2));
            cl.offMin = Math.min(cl.offMin, off); cl.offMax = Math.max(cl.offMax, off);
          });
        }
        state.catLabel = cl; state.catLabelKey = catKey;
      }
      var catLabel = state.catLabel;

      var area = { x0: box.x0, y0: box.y0 + headerH, x1: box.x1, y1: box.y1 - (capH ? capH + pt(5.5) : 0) };
      drawLegend(area);

      // Axeltitlar (coord_flip: x-titeln hamnar till vänster)
      var bottomTitle = HOR ? T.y_axis_title : T.x_axis_title;
      var leftTitle = HOR ? T.x_axis_title : T.y_axis_title;
      // (Facetter: kategoriaxelns titel visas när x_axis_title är angiven — den togs bort förut, som i func_graf_barchart
      // före 2026-10-13; utan angiven titel finns ingen att rita)
      var bottomSize = HOR ? T.y_axis_title_size : T.x_axis_title_size;
      var leftSize = HOR ? T.x_axis_title_size : T.y_axis_title_size;
      if (bottomTitle) {
        dynG.append("text").attr("text-anchor", "middle")
          .attr("transform", "translate(" + ((area.x0 + area.x1) / 2) + "," + (area.y1 - bottomSize * 0.3) + ") rotate(" + (-T.x_axis_title_angle) + ")")
          .style("font-size", bottomSize + "px").style("font-family", font).text(bottomTitle);
        area.y1 -= bottomSize * 1.6;
      }
      if (leftTitle) {
        dynG.append("text").attr("text-anchor", "middle")
          .attr("transform", "translate(" + (area.x0 + leftSize * 0.9) + "," + ((area.y0 + area.y1) / 2) + ") rotate(-90)")
          .style("font-size", leftSize + "px").style("font-family", font).text(leftTitle);
        area.x0 += leftSize * 1.6;
      }

      // Panelrutnät
      var n = F.levels.length, ncol = Math.min(F.ncol, n), nrow = Math.ceil(n / ncol);
      var sp = hasFacets ? 0.8 * LINES : 0;
      var stripLines = d3.max(F.levels, function (f) { return String(f).split("\n").length; });
      var stripH = hasFacets ? stripLines * T.facet_title_size * 1.05 + pt(16) : 0;
      var cellW = (area.x1 - area.x0 - (ncol - 1) * sp) / ncol;
      var cellH = (area.y1 - area.y0 - (nrow - 1) * sp) / nrow;

      // Per panel: kategorier, värdeomfång
      var allCats = categoriesFor(rows);
      var shared = sharedY ? valueDomain(domainBars) : null;
      // Etikettavstånd: gemensamt för alla paneler när y-skalan är gemensam, per panel bara vid fri y-skala
      // (som func_graf_barchart) — samma värde som valueDomain() räknade axeln med
      var sharedAn = sharedY ? autoNudge(labelBars(domainBars)) : null;
      var panelInfo = F.levels.map(function (f) {
        var pRows = rows.filter(function (r) { return r.f === f; });
        return {
          f: f,
          bars: bars.filter(function (b) { return b.f === f; }),
          cats: sharedX ? allCats : categoriesFor(pRows),
          vdom: shared || valueDomain(domainBars.filter(function (b) { return b.f === f; }))
        };
      });

      // Axelmått (samma för alla paneler så att de linjerar)
      var catSize = HOR ? T.y_axis_text_size : T.x_axis_text_size;
      var valSize = HOR ? T.x_axis_text_size : T.y_axis_text_size;
      var catLabW = 0, valLabW = 0;
      panelInfo.forEach(function (pi) {
        var cl = pi.cats || X.tick_labels;
        cl.forEach(function (c) {
          catLabW = Math.max(catLabW, vgrD3.measureText(svg, c, catSize, font, hlSet[c] ? "bold" : null));
        });
        valueTicks(d3.scaleLinear().domain(pi.vdom)).forEach(function (tk) {
          valLabW = Math.max(valLabW, vgrD3.measureText(svg, tk.label, valSize, font));
        });
      });
      var rad = X.angle * Math.PI / 180;
      var bottomLabW = HOR ? valLabW : catLabW, bottomLabSize = HOR ? valSize : catSize;
      var bottomH = (X.angle > 0 ? bottomLabW * Math.sin(rad) + bottomLabSize * Math.cos(rad) : bottomLabSize) + pt(5);
      var leftW = (HOR ? catLabW : valLabW) + pt(5);
      // Delad vänsteraxel (samma kategorier när liggande, samma värdeskala när stående): axeltexten bara i
      // första kolumnen och panelerna delar på den frigjorda bredden (som ggplot facet_wrap)
      var leftShared = hasFacets && ncol > 1 && (HOR ? sharedX : sharedY);
      var panelW = (area.x1 - area.x0 - leftW - (ncol - 1) * sp) / ncol;

      var panels = panelsG.selectAll("g.vgr-panel").data(panelInfo, function (pi) { return pi.f; })
        .join(function (enter) {
          var g = enter.append("g").attr("class", "vgr-panel");
          g.append("clipPath").append("rect");   // staplar klipps mot panelen (t.ex. med y_axis_min)
          g.append("g").attr("class", "vgr-grid");
          g.append("g").attr("class", "vgr-bars");
          g.append("g").attr("class", "vgr-refs");
          g.append("g").attr("class", "vgr-axes");
          g.append("g").attr("class", "vgr-labels");
          return g;
        });
      var panelRight = area.x0;

      panels.each(function (pi, i) {
        var g = d3.select(this);
        var col = i % ncol, row = Math.floor(i / ncol);
        var cx = area.x0 + col * (cellW + sp), cy = area.y0 + row * (cellH + sp);
        var rect = { x0: cx + leftW, y0: cy + stripH, x1: cx + cellW, y1: cy + cellH - bottomH };
        if (leftShared) {
          rect.x0 = area.x0 + leftW + col * (panelW + sp);
          rect.x1 = rect.x0 + panelW;
        }
        panelRight = Math.max(panelRight, rect.x1);
        var clipId = el.id + "-clip-" + i;
        g.select("clipPath").attr("id", clipId).select("rect")
          .attr("x", rect.x0).attr("y", rect.y0).attr("width", Math.max(0, rect.x1 - rect.x0)).attr("height", Math.max(0, rect.y1 - rect.y0));
        g.select(".vgr-bars").attr("clip-path", "url(#" + clipId + ")");
        g.select(".vgr-refs").attr("clip-path", "url(#" + clipId + ")");
        // Etikettplatsen (catLabel ovan) vid panelens första och sista kategori
        var needs = (pi.cats && pi.cats.length && catLabel.half > 0)
          ? [{ x: pi.cats[0], off: catLabel.offMin, half: catLabel.half },
             { x: pi.cats[pi.cats.length - 1], off: catLabel.offMax, half: catLabel.half }]
          : [];
        var cs = HOR ? makeCatScale(pi.cats, rect.y1, rect.y0, needs) : makeCatScale(pi.cats, rect.x0, rect.x1, needs);
        var vs = HOR ? d3.scaleLinear().domain(pi.vdom).range([rect.x0, rect.x1])
                     : d3.scaleLinear().domain(pi.vdom).range([rect.y1, rect.y0]);
        var vt = valueTicks(vs);
        var catTicks = pi.cats ? pi.cats.map(function (c) { return { v: cs.pos(c), label: c, bold: !!hlSet[c] }; })
                               : X.ticks.map(function (v, k) { return { v: v, label: X.tick_labels[k], bold: !!hlEnc[v] }; });

        // Rutnät och ram
        var grid = g.select(".vgr-grid");
        grid.selectAll("*").remove();
        if (hasFacets) {
          vgrD3.textBlock(grid, String(pi.f).split("\n"), { x: (rect.x0 + rect.x1) / 2, y: cy + pt(4), size: T.facet_title_size, font: font, lineHeight: 1.05 });
          grid.append("rect").attr("x", rect.x0).attr("y", rect.y0).attr("width", rect.x1 - rect.x0).attr("height", rect.y1 - rect.y0)
            .attr("fill", "none").attr("stroke", "#b3b3b3").attr("stroke-width", 0.85);
        }
        // setting: true/false eller "x"/"y" (linjer från den visade x- resp. y-axeln = lodräta resp. vågräta)
        function gridOn(setting, vertical) {
          return setting === true || (setting === "x" && vertical) || (setting === "y" && !vertical);
        }
        function gridLine(v, isVal, color, width, setting) {
          var p = isVal ? vs(v) : cs(v);
          var vertical = HOR ? isVal : !isVal;
          if (!gridOn(setting, vertical)) return;
          grid.append("line")
            .attr("x1", vertical ? p : rect.x0).attr("x2", vertical ? p : rect.x1)
            .attr("y1", vertical ? rect.y0 : p).attr("y2", vertical ? rect.y1 : p)
            .attr("stroke", color).attr("stroke-width", width);
        }
        var GMIN = spec.grid.minor, GMAJ = spec.grid.major;
        if (GMIN) {
          for (var k = 1; k < vt.length; k++) gridLine((vt[k - 1].v + vt[k].v) / 2, true, "#f2f2f2", 0.7, GMIN);
          if (X.minor) X.minor.forEach(function (v) { gridLine(v, false, "#f2f2f2", 0.7, GMIN); });
        }
        if (GMAJ) {
          vt.forEach(function (tk) { gridLine(tk.v, true, "#e5e5e5", 1.42, GMAJ); });
          catTicks.forEach(function (tk) { gridLine(tk.v, false, "#e5e5e5", 1.42, GMAJ); });
        }

        // Staplar
        function geom(b) {
          var c = cs(cs.pos(b.x) + b.off), w = b.w * cs.unit;
          var a = vs(b.v0), z = vs(b.v1);
          return HOR ? { x: Math.min(a, z), y: c - w / 2, width: Math.abs(a - z), height: w }
                     : { x: c - w / 2, y: Math.min(a, z), width: w, height: Math.abs(a - z) };
        }
        function zeroGeom(b) {
          var gm = geom(b), z0 = vs(0);
          return HOR ? { x: z0, y: gm.y, width: 0, height: gm.height } : { x: gm.x, y: z0, width: gm.width, height: 0 };
        }
        function setGeom(sel, fn) {
          sel.attr("x", function (b) { return fn(b).x; }).attr("y", function (b) { return fn(b).y; })
            .attr("width", function (b) { return Math.max(0, fn(b).width); })
            .attr("height", function (b) { return Math.max(0, fn(b).height); });
        }
        var barSel = g.select(".vgr-bars").selectAll("rect.vgr-bar").data(pi.bars, function (b) { return b.key; });
        var exiting = barSel.exit();
        (t ? exiting.transition().duration(t / 2).attr("opacity", 0) : exiting).remove();
        var BLN = spec.bar_line || {};   // kantlinje (bar_line_color/bar_line_width); null färg = ingen kant
        var entered = barSel.enter().append("rect").attr("class", "vgr-bar").attr("fill", barFill)
          .attr("stroke", BLN.color || "none").attr("stroke-width", BLN.color ? BLN.width : 0);
        var grow = state.first ? spec.animation.grow && dur > 0 : t > 0;
        if (grow) setGeom(entered, zeroGeom); else setGeom(entered, geom);
        var merged = entered.merge(barSel);
        merged
          .on("mouseenter", function (event, b) { hoverBar(b, this, event, pi.f); })
          .on("mousemove", function (event, b) { hoverBar(b, this, event, pi.f); })   // uppdateras även efter byte av staplingstyp
          .on("mouseleave", function () { hoverG.selectAll("*").remove(); tip.hide(); });
        var tt = grow || t ? merged.transition().duration(state.first ? dur : t) : merged;
        setGeom(tt, geom);
        tt.attr("fill", barFill).attr("opacity", barOpacity);

        // Referensvärden och referenslinjer
        var refs = g.select(".vgr-refs");
        refs.selectAll("*").remove();
        if (refVisible()) {
          var refFade = state.first && spec.animation.grow && dur > 0;   // tonas bara in om staplarna växer fram
          pi.bars.filter(function (b) { return !b.stacked && b.r.ref != null; }).forEach(function (b) {
            var c = cs(cs.pos(b.x) + b.off), w = b.w * cs.unit * 1.15, p = vs(b.r.ref);
            refs.append("line")
              .attr("x1", HOR ? p : c - w / 2).attr("x2", HOR ? p : c + w / 2)
              .attr("y1", HOR ? c - w / 2 : p).attr("y2", HOR ? c + w / 2 : p)
              .attr("stroke", REF.color).attr("stroke-width", 3).attr("stroke-linecap", "round")
              .attr("opacity", refFade ? 0 : 1)
              .transition().delay(refFade ? dur : 0).duration(refFade ? 200 : 0).attr("opacity", 1);
          });
        }
        if (!isFilled()) {
          spec.ref.y.forEach(function (v, i) {
            var p = vs(v);
            refs.append("line")
              .attr("x1", HOR ? p : rect.x0).attr("x2", HOR ? p : rect.x1)
              .attr("y1", HOR ? rect.y0 : p).attr("y2", HOR ? rect.y1 : p)
              .attr("stroke", "#000000").attr("stroke-width", 1.42).attr("stroke-dasharray", "6 4");
            var etiketter = spec.ref.y_label || [];
            var lab = etiketter.length ? etiketter[i % etiketter.length] : null;   // en etikett per linje
            if (lab) {
              refs.append("text")
                .attr("x", HOR ? p + 5 : rect.x1 - 4).attr("y", HOR ? rect.y0 + 14 : p - 6)
                .attr("text-anchor", HOR ? "start" : "end")
                .attr("fill", "#37474F").attr("stroke", "#ffffff").attr("stroke-width", 3).attr("paint-order", "stroke")
                .style("font-size", (13 * (spec.text_scale || 1)) + "px").style("font-family", font).text(lab);
            }
          });
        }

        // Axlar (theme_minimal: inga axellinjer om de inte slagits på med x_axis_line/y_axis_line)
        var axes = g.select(".vgr-axes");
        axes.selectAll("*").remove();
        var AXL = spec.axis_line || {};
        if (AXL.x) axes.append("line").attr("x1", rect.x0).attr("x2", rect.x1).attr("y1", rect.y1).attr("y2", rect.y1)
          .attr("stroke", "#000000").attr("stroke-width", 1.42);
        if (AXL.y) axes.append("line").attr("x1", rect.x0).attr("x2", rect.x0).attr("y1", rect.y0).attr("y2", rect.y1)
          .attr("stroke", "#000000").attr("stroke-width", 1.42);
        var leftTicks = !leftShared || col === 0 ? (HOR ? catTicks : vt) : [], bottomTicks = HOR ? vt : catTicks;
        var leftScale = HOR ? cs : vs, bottomScale = HOR ? vs : cs;
        axes.selectAll(null).data(leftTicks).enter().append("text")
          .attr("x", rect.x0 - pt(3)).attr("y", function (tk) { return leftScale(tk.v); }).attr("dy", "0.35em")
          .attr("text-anchor", "end").attr("fill", "#4d4d4d")
          .style("font-size", (HOR ? catSize : valSize) + "px").style("font-family", font)
          .style("font-weight", function (tk) { return tk.bold ? "bold" : null; })
          .text(function (tk) { return tk.label; });
        var bl = axes.selectAll(null).data(bottomTicks).enter().append("text")
          .attr("fill", "#4d4d4d").style("font-size", bottomLabSize + "px").style("font-family", font)
          .style("font-weight", function (tk) { return tk.bold ? "bold" : null; })
          .text(function (tk) { return tk.label; });
        if (X.angle > 0) {
          bl.attr("text-anchor", "end").attr("dy", "0.71em").attr("transform", function (tk) {
            return "translate(" + bottomScale(tk.v) + "," + (rect.y1 + pt(3)) + ") rotate(" + (-X.angle) + ")";
          });
        } else {
          bl.attr("text-anchor", "middle").attr("x", function (tk) { return bottomScale(tk.v); })
            .attr("y", rect.y1 + pt(3)).attr("dy", "0.85em");
        }

        // Dataetiketter — ritas när staplarna har landat
        var labG = g.select(".vgr-labels");
        labG.selectAll("*").remove();
        var lb = labelBars(pi.bars);
        if (lb.length) {
          var an = sharedY ? sharedAn : autoNudge(lb);
          var items = lb.map(function (b) {
            var dodged = spec.has_groups && state.type === "grouped";
            var catOff = b.off + (!dodged ? LB.nudge_x : 0);
            var c = cs(cs.pos(b.x) + catOff), v = vs(labelValue(b, an));
            // Kanten (inte mitten) läggs vid punkten ovanför/bredvid stapeln — samma villkor som func_graf_barchart:
            // "outside", automatiskt avstånd (nudge_y = 0) och ingen repel (repelOn ovan: gäller inte staplade staplar)
            var out =LB.position === "outside" && LB.nudge_y === 0 && !repelOn;
            var sign = b.stacked ? b.sgn : b.v;   // staplade/100 %: summans tecken (som stack_total i R)
            return {
              text: labelText(b),
              color: LB.color === "auto" ? (isTotalLabel(b) ? "#000000" : groupByKey[b.g].color) : LB.color,
              ax: HOR ? v : c, ay: HOR ? c : v, x: HOR ? v : c, y: HOR ? c : v,
              ox: HOR ? vs(b.v1) : c, oy: HOR ? c : vs(b.v1),
              alignStart: out ? (sign >= 0 ? 1 : -1) : 0
            };
          });
          var nodes = vgrD3.labelNodes(labG, items, { size: LB.size, font: font, box: LB.box, box_color: LB.box_color, box_alpha: 1 });
          // Etiketter utanför: kanten mot stapeln läggs vid punkten, så texten aldrig går in i stapeln/kantlinjen
          // (som func_graf_barchart: vjust 0/1 på stående, hjust 0/1 på liggande staplar). Negativa staplar åt andra hållet
          items.forEach(function (d) {
            if (!d.alignStart) return;
            if (HOR) { d.x += d.alignStart * d.w / 2; d.ax = d.x; }
            else { d.y -= d.alignStart * d.h / 2; d.ay = d.y; }
          });
          if (repelOn) {
            vgrD3.relaxLabels(items, rect, { sep: LB.force * pt(2), direction: "both", maxOverlaps: LB.max_overlaps });
            vgrD3.leaderLines(labG, items, { color: "#7f7f7f", width: 0.85 });
          } else {
            // Utan repel: en etikett som sticker ut förbi panelens kant längs kategoriaxeln (smala facetter, stor
            // text) flyttas in i panelen i stället för att rita över grannpanelen/axeltexten — som func_graf_barchart
            // (hjust) sedan 2026-10-09. Etiketter som är bredare än panelen lämnas centrerade
            items.forEach(function (d) {
              if (HOR) {
                var hh = d.h / 2 + 1;
                if (hh * 2 < rect.y1 - rect.y0) { d.y = vgrD3.clamp(d.y, rect.y0 + hh, rect.y1 - hh); d.ay = d.y; }
              } else {
                var hw = d.w / 2;
                if (hw * 2 <= rect.x1 - rect.x0) { d.x = vgrD3.clamp(d.x, rect.x0 + hw, rect.x1 - hw); d.ax = d.x; }
              }
            });
          }
          nodes.place();
          var delay = state.first ? (spec.animation.grow ? dur : 0) : t;
          if (delay) labG.attr("opacity", 0).transition().delay(delay).duration(250).attr("opacity", 1);
          else labG.attr("opacity", 1);
        }
      });

      if (capH) vgrD3.textBlock(dynG, T.caption, { x: panelRight, y: box.y1 - capH, size: T.caption_size, font: font, anchor: "end" });
      refreshControls();
      state.first = false;
    }

    // -------------------------------------------------------------------------
    //  Tooltip
    // -------------------------------------------------------------------------
    // tooltip_columns: den hovrade stapelns extra kolumner (formaterade i R), direkt under dess rad —
    // indragna när flera grupper visas, så att det syns vilken grupp de hör till
    function extraRows(r, indent) {
      var cols = TT.columns || [], out = "";
      cols.forEach(function (label, i) {
        var val = r.tt ? r.tt[i] : null;
        if (val == null) return;
        var row = vgrD3.tooltipRow(label, val);
        if (indent) row = row.replace("<div class='vgr-tt-row'>", "<div class='vgr-tt-row' style='padding-left:16px'>");
        out += row;
      });
      return out;
    }

    function hoverBar(b, node, event, facet) {
      hoverG.selectAll("*").remove();
      var bb = node.getBBox();
      hoverG.append("rect").attr("x", bb.x).attr("y", bb.y).attr("width", bb.width).attr("height", bb.height)
        .attr("fill", "none").attr("stroke", "#263238").attr("stroke-width", 2);
      if (!TT.show) return;
      var html = "<div class='vgr-tt-title'>" + esc(b.r.xt) + "</div>";
      var sub = [];
      if (hasFacets) sub.push(facet);
      if (spec.filter.enabled) sub.push(state.filter);
      if (sub.length) html += "<div class='vgr-tt-sub'>" + esc(sub.join(" · ")) + "</div>";
      var same = rowsFor(state.filter).filter(function (r) { return r.f === b.f && r.x === b.x; })
        .sort(function (a, c) { return gIndex[a.g] - gIndex[c.g]; });
      var total = d3.sum(same, function (r) { return Math.abs(r.v); });
      same.forEach(function (r) {
        var txt = fmtTip(r.v);
        if (spec.has_groups && state.type !== "grouped" && total) txt += " (" + vgrD3.fmt(100 * r.v / total, TT.set_decimals != null ? TT.set_decimals : 0, null) + " %)";
        var label = spec.has_groups ? groupByKey[r.g].label : (T.y_axis_title || "Värde");
        var row = vgrD3.tooltipRow(label, txt, groupByKey[r.g].color);
        if (r.g === b.g && same.length > 1) row = row.replace("<div class='vgr-tt-row'>", "<div class='vgr-tt-row' style='font-weight:bold'>");
        html += row;
        if (r.g === b.g) html += extraRows(r, same.length > 1);
      });
      if (spec.has_groups && same.length > 1) html += vgrD3.tooltipRow("Totalt", fmtTip(d3.sum(same, function (r) { return r.v; })));
      if (refVisible() && b.r.ref != null) html += vgrD3.tooltipRow(REF.label, fmtTip(b.r.ref), REF.color);
      tip.show(html, event);
    }

    // -------------------------------------------------------------------------
    //  Kontroller
    // -------------------------------------------------------------------------
    var timer = null, playBtn = null, filterSel = null;
    if (IA.type_toggle) {
      vgrD3.buttonGroup(controls, [
        { key: "grouped", label: "Grupperad" }, { key: "stacked", label: "Staplad" }, { key: "filled", label: "100 %" }
      ], state.type, function (k) { state.type = k; update(true); });
    }
    if (IA.sort) {
      var sortSel = controls.append("select").attr("aria-label", "Sortera")
        .style("font", "inherit").style("padding", "3px 6px").style("border", "1px solid #b0bec5").style("border-radius", "4px")
        .on("change", function () { state.sort = this.value; update(true); });
      sortSel.selectAll("option").data([
        { v: "original", t: "Ursprunglig ordning" }, { v: "value_desc", t: "Störst först" }, { v: "value_asc", t: "Minst först" },
        { v: "name_asc", t: "Namn A–Ö" }, { v: "name_desc", t: "Namn Ö–A" }
      ]).join("option").attr("value", function (d) { return d.v; }).text(function (d) { return d.t; });
      sortSel.property("value", state.sort);
    }
    function stopPlay() { if (timer) { timer.stop(); timer = null; } if (playBtn) playBtn.text("▶"); }
    function setFilter(k) { state.filter = k; if (filterSel) filterSel.property("value", k); update(true); }
    if (spec.filter.enabled) {
      if (spec.filter.label) controls.append("span").style("color", "#546e7a").text(spec.filter.label + ":");
      filterSel = controls.append("select").attr("aria-label", spec.filter.label || "Filter")
        .style("font", "inherit").style("padding", "3px 6px").style("border", "1px solid #b0bec5").style("border-radius", "4px")
        .on("change", function () { stopPlay(); setFilter(this.value); });
      filterSel.selectAll("option").data(spec.filter.values).join("option")
        .attr("value", function (d) { return d; }).text(function (d) { return d; });
      filterSel.property("value", state.filter);
      playBtn = vgrD3.button(controls, "▶", function () {
        if (timer) { stopPlay(); return; }
        var vals = spec.filter.values;
        if (vals.indexOf(state.filter) >= vals.length - 1) setFilter(vals[0]);
        playBtn.text("❚❚");
        timer = d3.interval(function () {
          var i = vals.indexOf(state.filter);
          if (i >= vals.length - 1) { stopPlay(); return; }
          setFilter(vals[i + 1]);
        }, spec.animation.play_interval);
      }, "Spela upp");
    }
    var dynamic = controls.append("span").style("display", "inline-flex").style("gap", "8px");
    controls.append("span").attr("class", "vgr-spacer");
    if (IA.export) vgrD3.exportButtons(controls, svg.node(), fileName);
    function refreshControls() {
      dynamic.selectAll("*").remove();
      if (Object.keys(state.hidden).length) {
        vgrD3.button(dynamic, "Visa alla", function () { state.hidden = {}; update(true); });
      }
    }
    if (controls.selectAll("button,select").empty()) controls.style("display", "none");

    update(false);
  };
})();
