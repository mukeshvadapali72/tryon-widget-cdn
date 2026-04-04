
/**
 * TryOnMe Widget v1.0.0
 * Uses Kolors Virtual Try-On (free HuggingFace) + Magic Hour (paid fallback)
 * Zero dependencies. Pure vanilla JS. Raw fetch only.
 */
;(function () {
  "use strict";
  if (window.__TRYONME__) return;
  window.__TRYONME__ = true;

  var sc = document.currentScript;
  function attr(n) { return sc ? sc.getAttribute("data-" + n) : null; }

  var CFG = {
    apiKey: attr("api-key") || "",
    accent: attr("accent") || "#c8f060",
    brandName: attr("brand-name") || "",
    position: attr("position") || "right",
    garmentType: attr("garment-type") || "upper_body",
    buttonStyle: attr("button-style") || "floating",
    injectAfter: attr("inject-after") || "",
    poweredBy: attr("powered-by") !== "false",
    productImage: attr("product-image") || "",
    buttonLabel: attr("button-label") || "Try It On Me",
  };

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function dataURLtoBlob(d) {
    var a = d.split(","), m = a[0].match(/:(.*?);/)[1], b = atob(a[1]);
    var u = new Uint8Array(b.length);
    for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
    return new Blob([u], { type: m });
  }

  function fetchImageAsBase64(url) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = function () {
        try {
          var c = document.createElement("canvas");
          c.width = img.naturalWidth; c.height = img.naturalHeight;
          c.getContext("2d").drawImage(img, 0, 0);
          resolve(c.toDataURL("image/jpeg", 0.9));
        } catch (e) { resolve(null); }
      };
      img.onerror = function () { resolve(null); };
      img.src = url + (url.indexOf("?") > -1 ? "&" : "?") + "_t=" + Date.now();
    });
  }

  var rgb = (function (h) {
    return { r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16) };
  })(CFG.accent);
  var accentRgba = function (a) { return "rgba(" + rgb.r + "," + rgb.g + "," + rgb.b + "," + a + ")"; };
  var accentFg = (rgb.r * 0.299 + rgb.g * 0.587 + rgb.b * 0.114) > 150 ? "#0a0a0b" : "#ffffff";

  function store(k, v) { try { localStorage.setItem("tryonme_" + k, v); } catch (e) {} }
  function load(k) { try { return localStorage.getItem("tryonme_" + k); } catch (e) { return null; } }

  /* ── Product image detection ── */
  function detectProductImage() {
    if (CFG.productImage) return CFG.productImage;
    var sels = [
      ".product__media img", ".product-featured-media img", ".product-single__photo img",
      ".product__photo img", "[data-product-featured-image]", ".product-gallery img",
      ".product-image-main img", ".product__main-photos img",
      'img[src*="cdn.shopify.com"][src*="products"]',
      'img[src*="assets.myntassets.com"]', "#landingImage",
      '[class*="ProductImage"] img', '[class*="product"] img',
      '[class*="gallery"] img', '[class*="pdp"] img', "main img",
    ];
    for (var s = 0; s < sels.length; s++) {
      var el = document.querySelector(sels[s]);
      if (el && el.src && el.src.indexOf("http") === 0 && el.naturalWidth > 150) return el.src;
    }
    var imgs = Array.from(document.querySelectorAll("img")).filter(function (i) {
      return i.naturalWidth > 200 && i.naturalHeight > 200 && i.src.indexOf("http") === 0 &&
        i.src.indexOf("logo") === -1 && i.src.indexOf("icon") === -1;
    }).sort(function (a, b) { return (b.naturalWidth * b.naturalHeight) - (a.naturalWidth * a.naturalHeight); });
    return imgs.length > 0 ? imgs[0].src : null;
  }

  /* ══════════════════════════════════════════════
     AI ENGINE 1: KOLORS (Free — raw fetch only)
     ══════════════════════════════════════════════ */
  var HF_SPACE = "https://kwai-kolors-kolors-virtual-try-on.hf.space";

  async function kolorsUpload(blob, name) {
    var fd = new FormData();
    fd.append("files", blob, name || "image.jpg");
    var r = await fetch(HF_SPACE + "/upload", { method: "POST", body: fd });
    if (!r.ok) throw new Error("HF upload failed: " + r.status);
    var paths = await r.json();
    return paths[0];
  }

  async function tryOnKolors(personB64, garmentB64, onProg) {
    onProg(10, "Connecting to AI...");
    var pBlob = dataURLtoBlob(personB64);
    var gBlob = dataURLtoBlob(garmentB64);

    onProg(18, "Uploading your photo...");
    var pPath = await kolorsUpload(pBlob, "person.jpg");

    onProg(30, "Uploading garment...");
    var gPath = await kolorsUpload(gBlob, "garment.jpg");

    onProg(42, "Starting AI try-on...");
    var hash = Math.random().toString(36).slice(2, 12);

    // Try direct predict first
    try {
      var pr = await fetch(HF_SPACE + "/api/predict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          data: [
            { path: pPath, meta: { _type: "gradio.FileData" } },
            { path: gPath, meta: { _type: "gradio.FileData" } },
            0, true
          ]
        })
      });
      if (pr.ok) {
        var pd = await pr.json();
        if (pd.data && pd.data[0]) {
          var rp = pd.data[0].url || pd.data[0].path || pd.data[0];
          if (typeof rp === "string" && rp.indexOf("http") === 0) return rp;
          if (typeof rp === "string") return HF_SPACE + "/file=" + rp;
          if (rp && rp.url) return rp.url;
        }
      }
    } catch (e) { /* fall through to queue method */ }

    // Queue-based approach
    onProg(48, "Joining AI queue...");
    var jr = await fetch(HF_SPACE + "/queue/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: [
          { path: pPath, meta: { _type: "gradio.FileData" } },
          { path: gPath, meta: { _type: "gradio.FileData" } },
          0, true
        ],
        fn_index: 0,
        session_hash: hash
      })
    });
    if (!jr.ok) throw new Error("Queue join failed: " + jr.status);

    for (var i = 0; i < 60; i++) {
      await sleep(2000);
      onProg(50 + Math.min(42, i * 2), "AI rendering... (" + ((i + 1) * 2) + "s)");
      try {
        var sr = await fetch(HF_SPACE + "/queue/data?session_hash=" + hash);
        var tx = await sr.text();
        var lines = tx.split("\n").filter(function (l) { return l.indexOf("data:") === 0; });
        for (var j = 0; j < lines.length; j++) {
          var ev = JSON.parse(lines[j].slice(5));
          if (ev.msg === "process_completed" && ev.output && ev.output.data) {
            var res = ev.output.data[0];
            if (res && res.url) return res.url;
            if (res && res.path) return HF_SPACE + "/file=" + res.path;
            if (typeof res === "string") return res;
          }
        }
      } catch (e) { /* keep polling */ }
    }
    throw new Error("Kolors timed out.");
  }

  /* ══════════════════════════════════════════════
     AI ENGINE 2: MAGIC HOUR (Paid fallback)
     ══════════════════════════════════════════════ */
  async function mhUpload(key, dataUrl) {
    var r = await fetch("https://api.magichour.ai/v1/files/upload-urls", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({ items: [{ extension: "jpg", type: "image" }] })
    });
    if (!r.ok) throw new Error("MH upload failed: " + r.status);
    var d = await r.json();
    await fetch(d.items[0].upload_url, { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: dataURLtoBlob(dataUrl) });
    return d.items[0].file_path;
  }

  async function tryOnMH(personB64, garmentB64, key, onProg) {
    onProg(10, "Uploading your photo...");
    var pp = await mhUpload(key, personB64);
    onProg(30, "Uploading garment...");
    var gp = await mhUpload(key, garmentB64);
    onProg(48, "Starting AI...");
    var cr = await fetch("https://api.magichour.ai/v1/ai-clothes-changer", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({ assets: { person_file_path: pp, garment_file_path: gp, garment_type: CFG.garmentType }, name: "TryOnMe" })
    });
    if (!cr.ok) throw new Error("MH job failed: " + cr.status);
    var jid = (await cr.json()).id;
    for (var i = 0; i < 45; i++) {
      await sleep(2000);
      onProg(50 + Math.min(44, i * 2), "AI rendering... (" + ((i + 1) * 2) + "s)");
      var sr = await fetch("https://api.magichour.ai/v1/image-projects/" + jid, { headers: { Authorization: "Bearer " + key } });
      var sd = await sr.json();
      if (sd.status === "complete") return sd.downloads?.[0]?.url || sd.output?.url || sd.url;
      if (sd.status === "error" || sd.status === "failed") throw new Error("MH processing failed.");
    }
    throw new Error("MH timed out.");
  }

  /* Combined: Kolors first, MH fallback */
  async function runTryOn(personB64, garmentB64, onProg) {
    try {
      return await tryOnKolors(personB64, garmentB64, onProg);
    } catch (e) {
      console.warn("[TryOnMe] Kolors failed:", e.message);
      if (!CFG.apiKey) throw new Error("AI service busy. Try again in a minute. (" + e.message + ")");
      onProg(8, "Switching to backup AI...");
      return await tryOnMH(personB64, garmentB64, CFG.apiKey, onProg);
    }
  }

  /* ══════════════════════════════════════════════
     WIDGET UI (Shadow DOM)
     ══════════════════════════════════════════════ */
  var H = document.createElement("div"); H.id = "tryonme-host"; document.body.appendChild(H);
  var sh = H.attachShadow({ mode: "closed" });
  var st = document.createElement("style");
  st.textContent = '@import url("https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap");*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}:host{--ac:' + CFG.accent + ';--fg:' + accentFg + ';font-family:"DM Sans",-apple-system,sans-serif}.fab{position:fixed;' + (CFG.position === "left" ? "left" : "right") + ':20px;bottom:24px;z-index:2147483646;background:var(--ac);color:var(--fg);border:none;border-radius:50px;padding:14px 22px;font-family:inherit;font-size:14px;font-weight:600;cursor:pointer;box-shadow:0 4px 24px rgba(0,0,0,.35);transition:all .3s;display:flex;align-items:center;gap:8px}.fab:hover{transform:translateY(-3px) scale(1.03)}.fab.hide{transform:translateY(100px);opacity:0;pointer-events:none}.ov{position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.65);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;opacity:0;pointer-events:none;transition:opacity .3s}.ov.open{opacity:1;pointer-events:auto}.md{background:#0e0e0f;border:1px solid #2e2e32;border-radius:20px;width:380px;max-width:calc(100vw - 24px);max-height:calc(100vh - 40px);overflow-y:auto;box-shadow:0 24px 80px rgba(0,0,0,.6);transform:translateY(16px) scale(.97);transition:transform .35s cubic-bezier(.34,1.56,.64,1);color:#f0f0ee}.ov.open .md{transform:translateY(0) scale(1)}.hd{padding:16px 20px 12px;border-bottom:1px solid #2e2e32;display:flex;align-items:center;justify-content:space-between}.lo{font-size:17px;font-weight:700}.lo em{color:var(--ac);font-style:italic}.xb{width:30px;height:30px;background:#1a1a1c;border:1px solid #2e2e32;border-radius:50%;color:#888;font-size:15px;cursor:pointer;display:flex;align-items:center;justify-content:center}.xb:hover{background:#242426;color:#f0f0ee}.bd{padding:18px 20px 14px}.sc{display:none}.sc.on{display:block}.uz{border:1.5px dashed #2e2e32;border-radius:14px;padding:28px 20px;text-align:center;cursor:pointer;background:#1a1a1c;transition:all .2s;position:relative}.uz:hover{border-color:var(--ac)}.uz input{position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:100%}.ui{width:50px;height:50px;margin:0 auto 10px;background:#242426;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:22px}.ut{font-size:14px;font-weight:600;margin-bottom:3px}.us{font-size:12px;color:#888}.sx{background:#1a1a1c;border-radius:10px;padding:12px 14px;margin-bottom:14px;display:flex;align-items:flex-start;gap:10px}.dt{width:8px;height:8px;border-radius:50%;margin-top:5px;flex-shrink:0}.dt.g{background:var(--ac)}.dt.o{background:#f0a060}.dt.p{animation:dp 1.2s infinite}@keyframes dp{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(.8)}}.st{font-size:12px;color:#888;line-height:1.6}.st b{color:#f0f0ee;display:block;margin-bottom:2px;font-weight:600}.pb{display:flex;align-items:center;gap:12px;background:#1a1a1c;border-radius:12px;padding:10px 14px;margin-bottom:12px}.pt{width:48px;height:48px;border-radius:50%;object-fit:cover;border:2px solid var(--ac)}.pi{flex:1}.pn{font-size:13px;font-weight:500}.ps{font-size:11px;color:var(--ac);margin-top:1px}.pc{font-size:11px;color:#888;cursor:pointer;text-decoration:underline;background:none;border:none;font-family:inherit}.gv{display:flex;align-items:center;gap:12px;background:#1a1a1c;border-radius:12px;padding:10px 14px;margin-bottom:14px}.gi{width:56px;height:72px;border-radius:8px;object-fit:cover;background:#242426}.gl{font-size:10px;color:var(--ac);font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px}.gx{font-size:12px;color:#888;line-height:1.4}.bt{width:100%;padding:13px;border:none;border-radius:12px;font-family:inherit;font-size:14px;font-weight:600;cursor:pointer;transition:all .2s}.bt.p{background:var(--ac);color:var(--fg)}.bt.p:hover{filter:brightness(1.1)}.bt.s{background:transparent;color:#888;border:1px solid #2e2e32;margin-top:8px;font-size:13px;font-weight:400}.bt.s:hover{border-color:#888;color:#f0f0ee}.pw{background:#242426;border-radius:8px;height:5px;overflow:hidden;margin:14px 0 8px}.pf{height:100%;background:var(--ac);border-radius:8px;width:0%;transition:width .4s}.pl{font-size:12px;color:#888;text-align:center}.rg{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px}.ri{position:relative;border-radius:10px;overflow:hidden;aspect-ratio:3/4;background:#242426}.ri img{width:100%;height:100%;object-fit:cover}.rl{position:absolute;bottom:8px;left:8px;font-size:10px;font-weight:600;background:rgba(0,0,0,.65);color:#888;padding:3px 8px;border-radius:6px;text-transform:uppercase;letter-spacing:.5px}.rl.y{background:' + accentRgba(0.3) + ';color:var(--ac)}.sb{display:flex;gap:6px;margin-top:10px}.sn{flex:1;padding:8px;background:#1a1a1c;border:1px solid #2e2e32;border-radius:8px;font-family:inherit;font-size:11px;font-weight:500;color:#888;cursor:pointer;text-align:center}.sn:hover{border-color:var(--ac);color:#f0f0ee}.tp{font-size:11px;color:#888;background:#1a1a1c;border-radius:10px;padding:10px 14px;line-height:1.6;margin-top:12px}.tp b{color:var(--ac)}.ft{padding:10px 20px 12px;border-top:1px solid #2e2e32;text-align:center;font-size:10px;color:#555}.er{background:#2a1515;border:1px solid #4a2020;border-radius:10px;padding:12px 14px;font-size:12px;color:#ff9090;margin-bottom:14px;line-height:1.6}@media(max-width:480px){.md{width:100%;border-radius:20px 20px 0 0;max-height:90vh}.ov.open{align-items:flex-end}}';
  sh.appendChild(st);

  var w = document.createElement("div");
  w.innerHTML = '<button class="fab" id="fab">\uD83D\uDC57 ' + CFG.buttonLabel + '</button><div class="ov" id="ov"><div class="md"><div class="hd"><div class="lo">' + (CFG.brandName ? CFG.brandName + " <em>TryOn</em>" : "TryOn<em>Me</em>") + '</div><button class="xb" id="xb">\u2715</button></div><div class="bd sc on" id="s1"><div class="sx"><div class="dt o"></div><div class="st"><b>Upload your photo to get started</b>One clear front-facing photo. Stored only on your device.</div></div><div class="uz"><input type="file" accept="image/*" id="fi"/><div class="ui">\uD83D\uDCF8</div><div class="ut">Tap to upload your photo</div><div class="us">JPG or PNG \u00B7 Front-facing \u00B7 Upper body visible</div></div><div class="tp"><b>Tip:</b> Stand straight, arms at sides, good lighting.</div></div><div class="bd sc" id="s2"><div class="pb"><img class="pt" id="t1" src="" alt=""/><div class="pi"><div class="pn" id="pn">Your photo</div><div class="ps">\u2713 Photo ready</div></div><button class="pc" id="ch">Change</button></div><div class="gv" id="gv"><img class="gi" id="gm" src="" alt=""/><div><div class="gl">Product detected \u2713</div><div class="gx" id="gx">Ready to try on you.</div></div></div><button class="bt p" id="go">\uD83D\uDC57 Try It On Me</button><div class="tp"><b>How it works:</b> AI renders this garment onto your photo. Takes 30\u201360 seconds.</div></div><div class="bd sc" id="s3"><div class="pb"><img class="pt" id="t2" src="" alt=""/><div class="pi"><div class="pn">Processing...</div><div class="ps" id="ps">Starting</div></div></div><div class="sx"><div class="dt g p"></div><div class="st"><b>AI is working on your try-on</b>This usually takes 30\u201360 seconds.</div></div><div class="pw"><div class="pf" id="pb"></div></div><div class="pl" id="pm">Starting...</div></div><div class="bd sc" id="s4"><div class="rg"><div class="ri"><img id="ro" src="" alt=""/><div class="rl">Original</div></div><div class="ri"><img id="ry" src="" alt=""/><div class="rl y">You \u2728</div></div></div><button class="bt p" id="rp">\u2705 Replace Product Image</button><button class="bt s" id="ag">\u21A9 Try Another</button><div class="sb"><button class="sn" id="sw">WhatsApp</button><button class="sn" id="sc">Copy Link</button><button class="sn" id="sd">Download</button></div></div><div class="bd sc" id="s5"><div class="er" id="em">Something went wrong.</div><button class="bt p" id="rt">Try Again</button><button class="bt s" id="bk">\u2190 Go Back</button></div>' + (CFG.poweredBy ? '<div class="ft">Powered by TryOnMe</div>' : '') + '</div></div>';
  sh.appendChild(w);

  var $ = function (id) { return sh.getElementById(id); };
  var curImg = null;

  function showS(n) { ["1","2","3","4","5"].forEach(function(s){ var e=$("s"+s);if(e)e.classList.toggle("on",s===n); }); }
  function openM() { $("ov").classList.add("open"); $("fab").classList.add("hide"); document.body.style.overflow="hidden"; curImg=detectProductImage(); if(load("photo")){$("t1").src=load("photo");$("pn").textContent=load("pname")||"Your photo";if(curImg){$("gm").src=curImg;$("gv").style.display="flex";}showS("2");}else{showS("1");} }
  function closeM() { $("ov").classList.remove("open"); $("fab").classList.remove("hide"); document.body.style.overflow=""; }

  $("fab").onclick = openM;
  $("xb").onclick = closeM;
  $("ov").onclick = function(e){if(e.target===$("ov"))closeM();};
  $("ch").onclick = function(){showS("1");};
  $("ag").onclick = function(){showS("2");};
  $("rt").onclick = function(){$("go").click();};
  $("bk").onclick = function(){showS("2");};

  $("fi").onchange = function(e) {
    var f=e.target.files[0]; if(!f)return;
    var r=new FileReader();
    r.onload=function(ev){
      store("photo",ev.target.result); store("pname",f.name);
      $("t1").src=ev.target.result; $("t2").src=ev.target.result; $("pn").textContent=f.name;
      curImg=detectProductImage();
      if(curImg){$("gm").src=curImg;$("gv").style.display="flex";}
      showS("2");
    };
    r.readAsDataURL(f);
  };

  $("go").onclick = async function() {
    showS("3"); $("t2").src=load("photo")||"";
    function prog(p,m){$("pb").style.width=p+"%";$("pm").textContent=m;$("ps").textContent=m;}
    try {
      curImg = curImg || detectProductImage();
      if(!curImg) throw new Error("Could not detect a product image on this page.");
      prog(5,"Loading product image...");
      var gB = await fetchImageAsBase64(curImg);
      if(!gB) throw new Error("Could not load the product image.");
      var pB = load("photo");
      if(!pB) throw new Error("Please upload your photo first.");
      var result = await runTryOn(pB, gB, prog);
      store("lastR",result); store("lastO",curImg);
      $("ro").src=curImg; $("ry").src=result;
      prog(100,"Done!");
      setTimeout(function(){showS("4");},300);
    } catch(err) {
      console.error("[TryOnMe]",err);
      $("em").textContent=err.message||"Something went wrong.";
      showS("5");
    }
  };

  $("rp").onclick = function() {
    var orig=load("lastO"), res=load("lastR"); if(!orig||!res)return;
    var of=orig.split("?")[0].split("/").pop(); var rpl=0;
    document.querySelectorAll("img").forEach(function(img){
      if(img.closest("#tryonme-host"))return;
      var f=img.src.split("?")[0].split("/").pop();
      if(img.src===orig||f===of){img.style.transition="opacity .5s";img.style.opacity="0";setTimeout(function(){img.src=res;img.style.opacity="1";},250);rpl++;}
    });
    if(!rpl){var b=Array.from(document.querySelectorAll("img")).filter(function(i){return!i.closest("#tryonme-host")&&i.naturalWidth>200;}).sort(function(a,b){return(b.naturalWidth*b.naturalHeight)-(a.naturalWidth*a.naturalHeight);})[0];if(b){b.style.transition="opacity .5s";b.style.opacity="0";setTimeout(function(){b.src=res;b.style.opacity="1";},250);}}
    closeM();
  };

  $("sw").onclick=function(){window.open("https://wa.me/?text="+encodeURIComponent("Check how this looks on me! "+location.href),"_blank");};
  $("sc").onclick=function(){navigator.clipboard.writeText(location.href);$("sc").textContent="Copied!";setTimeout(function(){$("sc").textContent="Copy Link";},2000);};
  $("sd").onclick=function(){var a=document.createElement("a");a.href=load("lastR");a.download="tryon.jpg";a.target="_blank";a.click();};

  if(CFG.buttonStyle==="inline"&&CFG.injectAfter){
    $("fab").style.display="none";
    var tgt=document.querySelector(CFG.injectAfter);
    if(tgt){var ib=document.createElement("button");ib.textContent="\uD83D\uDC57 "+CFG.buttonLabel;ib.style.cssText="width:100%;padding:14px 20px;margin:8px 0;background:"+CFG.accent+";color:"+accentFg+";border:2px solid "+accentRgba(0.5)+";border-radius:10px;font-family:'DM Sans',sans-serif;font-size:14px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px";ib.onclick=openM;tgt.insertAdjacentElement("afterend",ib);}
  }

  window.TryOnMe={open:openM,close:closeM,setProductImage:function(u){curImg=u;}};
  console.log("[TryOnMe] v1.0.0 loaded");
})();
