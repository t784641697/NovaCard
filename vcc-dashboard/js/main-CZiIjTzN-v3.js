(function(){const t=document.createElement("link").relList;if(t&&t.supports&&t.supports("modulepreload"))return;for(const o of document.querySelectorAll('link[rel="modulepreload"]'))i(o);new MutationObserver(o=>{for(const a of o)if(a.type==="childList")for(const r of a.addedNodes)r.tagName==="LINK"&&r.rel==="modulepreload"&&i(r)}).observe(document,{childList:!0,subtree:!0});function n(o){const a={};return o.integrity&&(a.integrity=o.integrity),o.referrerPolicy&&(a.referrerPolicy=o.referrerPolicy),o.crossOrigin==="use-credentials"?a.credentials="include":o.crossOrigin==="anonymous"?a.credentials="omit":a.credentials="same-origin",a}function i(o){if(o.ep)return;o.ep=!0;const a=n(o);fetch(o.href,a)}})();const ut=window.location.hostname==="localhost"||window.location.hostname==="127.0.0.1"?"http://localhost:3000/api":"/api";let T=localStorage.getItem("vcc_token")||null,h=JSON.parse(localStorage.getItem("vcc_me")||"null");function q(e){T=e,e?localStorage.setItem("vcc_token",e):localStorage.removeItem("vcc_token")}function V(e){h=e,e?localStorage.setItem("vcc_me",JSON.stringify(e)):localStorage.removeItem("vcc_me")}function pt(){T=null,h=null,localStorage.removeItem("vcc_token"),localStorage.removeItem("vcc_me")}const B=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;let R=null;function mt(e){return e.startsWith("✅")?"success":e.startsWith("❌")?"error":e.startsWith("⚠️")||e.startsWith("🔒")||e.startsWith("📭")?"warning":"success"}function gt(e,t){const n={success:"✓",error:"✕",warning:"!"},i={success:"操作成功",error:"操作失败",warning:"提示"};return'<div class="toast-icon">'+n[e]+'</div><div class="toast-body"><div class="toast-title">'+i[e]+'</div><div class="toast-msg">'+t+"</div></div>"}function c(e,t=2800){const n=mt(e);Y(e.replace(/^[✅❌⚠️]\s*/,""),n,t)}function Y(e,t="success",n=2800){const i=document.getElementById("toast");i&&(i.innerHTML='<div class="toast-box '+t+'">'+gt(t,e)+"</div>",i.classList.add("show"),clearTimeout(R),R=setTimeout(()=>{i.classList.remove("show")},n))}async function m(e,t={}){try{const n={"Content-Type":"application/json",...t.headers||{}};T&&(n.Authorization="Bearer "+T);const i=new AbortController,o=setTimeout(()=>i.abort(),6e4),a=await fetch(ut+e,{...t,headers:n,signal:i.signal});if(clearTimeout(o),a.status===429)return{code:429,msg:"请求过于频繁，请稍后再试"};if(!a.ok&&a.status!==200&&a.status!==304){let s=`HTTP ${a.status}`;try{s=(await a.json()).msg||s}catch{}return{code:a.status,msg:s}}const r=await a.json();if(a.status===401)throw pt(),window.showAuth&&window.showAuth(),new Error("Unauthorized");return r}catch(n){let i;if(n.name==="AbortError")i="请求超时，请检查网络连接或刷新重试";else if(n.name==="TypeError")i="网络连接失败，请检查网络";else{if(n.message==="Unauthorized")throw n;i=`请求失败: ${n.message}`}return{code:-1,msg:i}}}const ft={get:e=>m(e,{method:"GET"}),post:(e,t)=>m(e,{method:"POST",body:JSON.stringify(t)}),put:(e,t)=>m(e,{method:"PUT",body:JSON.stringify(t)}),del:e=>m(e,{method:"DELETE"})};class D{constructor(t={}){this.options={title:t.title||"",width:t.width||"500px",closable:t.closable!==!1,maskClosable:t.maskClosable!==!1,onClose:t.onClose||null,className:t.className||""},this.overlay=null,this.modal=null,this.isOpen=!1}create(t){this.destroy(),this.overlay=document.createElement("div"),this.overlay.className="modal-overlay",this.overlay.style.cssText=`
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.7);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      opacity: 0;
      transition: opacity 0.3s ease;
    `,this.modal=document.createElement("div"),this.modal.className=`modal-container ${this.options.className}`,this.modal.style.cssText=`
      background: linear-gradient(135deg, #13192a 0%, #1d2035 100%);
      border: 1px solid rgba(167,139,250,0.15);
      border-radius: 16px;
      width: ${this.options.width};
      max-width: 90vw;
      max-height: 85vh;
      overflow: hidden;
      transform: scale(0.9) translateY(20px);
      transition: transform 0.3s ease;
      box-shadow: 0 20px 60px rgba(0,0,0,0.5);
    `;let n="";return this.options.title&&(n+=`
        <div class="modal-header" style="
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 20px 24px;
          border-bottom: 1px solid rgba(255,255,255,0.08);
        ">
          <h3 style="
            margin: 0;
            font-size: 1.1rem;
            font-weight: 600;
            color: var(--text);
            background: var(--grad);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
          ">${this.options.title}</h3>
          ${this.options.closable?`
            <button class="modal-close" style="
              background: none;
              border: none;
              color: var(--text2);
              font-size: 24px;
              cursor: pointer;
              padding: 0;
              width: 32px;
              height: 32px;
              display: flex;
              align-items: center;
              justify-content: center;
              border-radius: 8px;
              transition: all 0.2s;
            ">×</button>
          `:""}
        </div>
      `),n+=`
      <div class="modal-body" style="
        padding: 24px;
        overflow-y: auto;
        max-height: calc(85vh - ${this.options.title?"80px":"0px"});
      ">
        ${t}
      </div>
    `,this.modal.innerHTML=n,this.overlay.appendChild(this.modal),this.bindEvents(),this}bindEvents(){const t=this.modal.querySelector(".modal-close");t&&(t.addEventListener("click",()=>this.close()),t.addEventListener("mouseenter",()=>{t.style.background="rgba(255,95,95,0.15)",t.style.color="#ff5f5f"}),t.addEventListener("mouseleave",()=>{t.style.background="none",t.style.color="var(--text2)"})),this.options.maskClosable&&this.overlay.addEventListener("click",n=>{n.target===this.overlay&&this.close()}),this.escHandler=n=>{n.key==="Escape"&&this.isOpen&&this.close()},document.addEventListener("keydown",this.escHandler)}open(t){return this.create(t),document.body.appendChild(this.overlay),document.body.style.overflow="hidden",requestAnimationFrame(()=>{this.overlay.style.opacity="1",this.modal.style.transform="scale(1) translateY(0)"}),this.isOpen=!0,this}close(){this.isOpen&&(this.overlay.style.opacity="0",this.modal.style.transform="scale(0.9) translateY(20px)",setTimeout(()=>{this.destroy(),this.options.onClose&&this.options.onClose()},300),this.isOpen=!1)}destroy(){this.escHandler&&document.removeEventListener("keydown",this.escHandler),this.overlay&&(this.overlay.remove(),document.body.style.overflow=""),this.overlay=null,this.modal=null}setContent(t){var i;const n=(i=this.modal)==null?void 0:i.querySelector(".modal-body");n&&(n.innerHTML=t)}getBody(){var t;return(t=this.modal)==null?void 0:t.querySelector(".modal-body")}}function vt(e){const{title:t,content:n,onConfirm:i,onCancel:o,confirmText:a="确认",cancelText:r="取消",confirmType:s="primary"}=e,d=new D({title:t,width:"420px",closable:!0,maskClosable:!0}),u=`
    <div style="color: var(--text2); line-height: 1.6;">${n}</div>
    <div style="display: flex; gap: 12px; justify-content: flex-end; margin-top: 24px;">
      <button class="modal-btn-cancel" style="
        padding: 10px 24px;
        border-radius: 10px;
        border: 1px solid rgba(255,255,255,0.15);
        background: transparent;
        color: var(--text2);
        cursor: pointer;
        font-size: 0.9rem;
        transition: all 0.2s;
      ">${r}</button>
      <button class="modal-btn-confirm" style="
        padding: 10px 24px;
        border-radius: 10px;
        border: none;
        background: ${{primary:"linear-gradient(135deg,#7eb8f7,#a78bfa)",danger:"linear-gradient(135deg,#ff5f5f,#ff8f8f)",success:"linear-gradient(135deg,#00c758,#00f2fe)"}[s]};
        color: white;
        cursor: pointer;
        font-size: 0.9rem;
        font-weight: 600;
        transition: all 0.2s;
      ">${a}</button>
    </div>
  `;return d.open(u),d.modal.querySelector(".modal-btn-cancel").addEventListener("click",()=>{d.close(),o&&o()}),d.modal.querySelector(".modal-btn-confirm").addEventListener("click",()=>{d.close(),i&&i()}),d}function yt(e){const{title:t,content:n,onClose:i,buttonText:o="知道了"}=e,a=new D({title:t,width:"400px",closable:!0,onClose:i}),r=`
    <div style="color: var(--text2); line-height: 1.6;">${n}</div>
    <div style="display: flex; justify-content: center; margin-top: 24px;">
      <button class="modal-btn-ok" style="
        padding: 10px 40px;
        border-radius: 10px;
        border: none;
        background: var(--grad);
        color: white;
        cursor: pointer;
        font-size: 0.9rem;
        font-weight: 600;
        transition: all 0.2s;
      ">${o}</button>
    </div>
  `;return a.open(r),a.modal.querySelector(".modal-btn-ok").addEventListener("click",()=>{a.close()}),a}class J{constructor(t,n={}){this.container=typeof t=="string"?document.querySelector(t):t,this.options={columns:n.columns||[],data:n.data||[],loading:n.loading||!1,emptyText:n.emptyText||"暂无数据",striped:n.striped!==!1,bordered:n.bordered!==!1,hover:n.hover!==!1,onRowClick:n.onRowClick||null,rowKey:n.rowKey||"id",...n},this.selectedKeys=new Set}render(){if(!this.container)return;const{columns:t,data:n,loading:i,emptyText:o}=this.options;if(i){this.container.innerHTML=this.renderLoading();return}if(!n||n.length===0){this.container.innerHTML=this.renderEmpty(o);return}const a=`
      width: 100%;
      border-collapse: separate;
      border-spacing: 0;
      font-size: 0.9rem;
    `,r=`
      background: rgba(167,139,250,0.08);
      color: var(--text2);
      font-weight: 500;
      text-align: left;
      padding: 14px 16px;
      border-bottom: 1px solid rgba(255,255,255,0.08);
    `,s=`
      padding: 14px 16px;
      border-bottom: 1px solid rgba(255,255,255,0.05);
      color: var(--text);
      transition: background 0.2s;
    `,d=t.map(g=>{const f=g.align||"left",v=g.width?`width: ${g.width};`:"";return`<th style="${r} ${v} text-align: ${f};">${g.title}</th>`}).join(""),l=n.map((g,f)=>{const v=this.options.hover?"cursor: pointer;":"",y=this.options.striped&&f%2===1?"background: rgba(255,255,255,0.02);":"",b=t.map($=>{const A=$.align||"left",O=this.getValue(g,$.dataIndex),ct=$.render?$.render(O,g,f):O;return`<td style="${s} text-align: ${A}; ${y}">${ct}</td>`}).join("");return`<tr data-key="${g[this.options.rowKey]||f}" style="${v} ${y}">${b}</tr>`}).join(""),u=this.options.bordered?`
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 12px;
      overflow: hidden;
    `:"";this.container.innerHTML=`
      <div style="overflow-x: auto; ${u}">
        <table style="${a}">
          <thead><tr>${d}</tr></thead>
          <tbody>${l}</tbody>
        </table>
      </div>
    `,this.options.onRowClick&&this.container.querySelectorAll("tbody tr").forEach((g,f)=>{g.addEventListener("click",()=>{this.options.onRowClick(n[f],f)})})}getValue(t,n){return n?n.split(".").reduce((i,o)=>i&&i[o],t):t}renderLoading(){return`
      <div style="
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 60px 20px;
        color: var(--text2);
      ">
        <div style="
          width: 40px;
          height: 40px;
          border: 3px solid rgba(167,139,250,0.2);
          border-top-color: #a78bfa;
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin-bottom: 16px;
        "></div>
        <style>
          @keyframes spin { to { transform: rotate(360deg); } }
        </style>
        <span>加载中...</span>
      </div>
    `}renderEmpty(t){return`
      <div style="
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 60px 20px;
        color: var(--text2);
      ">
        <div style="font-size: 48px; opacity: 0.3; margin-bottom: 16px;">📭</div>
        <span>${t}</span>
      </div>
    `}setData(t){this.options.data=t,this.render()}setColumns(t){this.options.columns=t,this.render()}setLoading(t){this.options.loading=t,this.render()}selectRow(t){this.selectedKeys.add(t),this.updateRowStyle(t,!0)}deselectRow(t){this.selectedKeys.delete(t),this.updateRowStyle(t,!1)}updateRowStyle(t,n){const i=this.container.querySelector(`tr[data-key="${t}"]`);i&&(i.style.background=n?"rgba(167,139,250,0.1)":"")}getSelectedData(){return this.options.data.filter(t=>this.selectedKeys.has(t[this.options.rowKey]))}}function ht(e,t){const n=new J(e,t);return n.render(),n}class G{constructor(t,n={}){this.container=typeof t=="string"?document.querySelector(t):t,this.options={current:n.current||1,pageSize:n.pageSize||10,total:n.total||0,showSizeChanger:n.showSizeChanger!==!1,showQuickJumper:n.showQuickJumper!==!1,showTotal:n.showTotal!==!1,pageSizeOptions:n.pageSizeOptions||[10,20,50,100],onChange:n.onChange||null,onShowSizeChange:n.onShowSizeChange||null,...n}}render(){if(!this.container)return;const{current:t,pageSize:n,total:i,showSizeChanger:o,showQuickJumper:a,showTotal:r,pageSizeOptions:s}=this.options,d=Math.ceil(i/n)||1;if(i===0){this.container.innerHTML="";return}const l=r?`<span style="color: var(--text2); font-size: 0.85rem;">共 ${i} 条</span>`:"",u=this.renderPageButtons(t,d),g=o?`
      <select class="page-size-select" style="
        padding: 6px 12px;
        border-radius: 8px;
        border: 1px solid rgba(255,255,255,0.15);
        background: rgba(0,0,0,0.3);
        color: var(--text);
        font-size: 0.85rem;
        cursor: pointer;
        outline: none;
      ">
        ${s.map(v=>`<option value="${v}" ${v===n?"selected":""}>${v} 条/页</option>`).join("")}
      </select>
    `:"",f=a&&d>1?`
      <span style="color: var(--text2); font-size: 0.85rem;">跳至</span>
      <input type="number" class="page-jumper" min="1" max="${d}" style="
        width: 50px;
        padding: 6px 8px;
        border-radius: 8px;
        border: 1px solid rgba(255,255,255,0.15);
        background: rgba(0,0,0,0.3);
        color: var(--text);
        font-size: 0.85rem;
        text-align: center;
        outline: none;
      " onkeydown="if(event.key==='Enter'){this.blur()}">
      <span style="color: var(--text2); font-size: 0.85rem;">页</span>
    `:"";this.container.innerHTML=`
      <div style="
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 16px;
        padding: 16px 0;
        flex-wrap: wrap;
      ">
        ${l}
        <div style="display: flex; align-items: center; gap: 6px;">
          ${u}
        </div>
        ${g}
        ${f}
      </div>
    `,this.bindEvents()}renderPageButtons(t,n){const i=[];i.push(this.renderButton("prev","‹",t>1,t));let a=1,r=n;if(n>7){const s=Math.floor(3.5);t<=s?r=5:t>=n-s?a=n-7+3:(a=t-s+2,r=t+s-2)}a>1&&(i.push(this.renderButton(1,"1",!0,t)),a>2&&i.push('<span style="color: var(--text2); padding: 0 4px;">...</span>'));for(let s=a;s<=r;s++)i.push(this.renderButton(s,String(s),!0,t));return r<n&&(r<n-1&&i.push('<span style="color: var(--text2); padding: 0 4px;">...</span>'),i.push(this.renderButton(n,String(n),!0,t))),i.push(this.renderButton("next","›",t<n,t,n)),i.join("")}renderButton(t,n,i,o,a=null){const r=t===o,d=`
      min-width: ${t==="prev"||t==="next"?"36px":"32px"};
      height: 32px;
      padding: 0 8px;
      border-radius: 8px;
      border: none;
      font-size: 0.85rem;
      cursor: ${i?"pointer":"not-allowed"};
      transition: all 0.2s;
      display: flex;
      align-items: center;
      justify-content: center;
    `,l=r?`
      background: var(--grad);
      color: white;
      font-weight: 600;
    `:`
      background: rgba(255,255,255,0.05);
      color: ${i?"var(--text)":"var(--text3)"};
    `,u=!r&&i?`
      onmouseenter="this.style.background='rgba(167,139,250,0.2)'"
      onmouseleave="this.style.background='rgba(255,255,255,0.05)'"
    `:"",g=t==="prev"?o-1:t==="next"?o+1:t;return`<button
      class="page-btn${r?" active":""}"
      data-page="${g}"
      style="${d} ${l}"
      ${i?"":"disabled"}
      ${u}
    >${n}</button>`}bindEvents(){this.container.querySelectorAll(".page-btn:not([disabled])").forEach(i=>{i.addEventListener("click",()=>{const o=parseInt(i.dataset.page);o!==this.options.current&&this.changePage(o)})});const t=this.container.querySelector(".page-size-select");t&&t.addEventListener("change",i=>{const o=parseInt(i.target.value);this.changePageSize(o)});const n=this.container.querySelector(".page-jumper");n&&n.addEventListener("blur",()=>{let i=parseInt(n.value);const o=Math.ceil(this.options.total/this.options.pageSize);i&&i>=1&&i<=o&&i!==this.options.current&&this.changePage(i),n.value=""})}changePage(t){this.options.current=t,this.render(),this.options.onChange&&this.options.onChange(t,this.options.pageSize)}changePageSize(t){this.options.pageSize=t,this.options.current=1,this.render(),this.options.onShowSizeChange&&this.options.onShowSizeChange(1,t),this.options.onChange&&this.options.onChange(1,t)}update(t){Object.assign(this.options,t),this.render()}}function bt(e,t){const n=new G(e,t);return n.render(),n}async function xt(e){try{return await navigator.clipboard.writeText(e),!0}catch{return wt(e)}}function wt(e){const t=document.createElement("textarea");t.value=e,t.style.cssText="position:fixed;left:-9999px;top:-9999px;opacity:0",document.body.appendChild(t),t.select();try{const n=document.execCommand("copy");return document.body.removeChild(t),n}catch{return document.body.removeChild(t),!1}}function Et(e,t){const n=document.getElementById(e);if(!n)return;const i=n.type==="password";n.type=i?"text":"password",t.textContent=i?"🙈":"👁",t.style.opacity=i?"0.9":"0.6"}function $t(e){const t=document.getElementById(e);t&&t.focus()}function w(e,t=2){return e==null||isNaN(e)?"-":Number(e).toFixed(t).replace(/\B(?=(\d{3})+(?!\d))/g,",")}function Ct(e,t="YYYY-MM-DD HH:mm:ss"){if(!e)return"-";const n=typeof e=="string"?new Date(e):e;if(isNaN(n.getTime()))return"-";const i=n.getFullYear(),o=String(n.getMonth()+1).padStart(2,"0"),a=String(n.getDate()).padStart(2,"0"),r=String(n.getHours()).padStart(2,"0"),s=String(n.getMinutes()).padStart(2,"0"),d=String(n.getSeconds()).padStart(2,"0");return t.replace("YYYY",i).replace("MM",o).replace("DD",a).replace("HH",r).replace("mm",s).replace("ss",d)}function Tt(e,t=300){let n=null;return function(...i){n&&clearTimeout(n),n=setTimeout(()=>e.apply(this,i),t)}}function St(e,t=300){let n=!1;return function(...i){n||(e.apply(this,i),n=!0,setTimeout(()=>n=!1,t))}}const kt={active:{label:"正常",color:"#00c758",bg:"rgba(0,199,88,.12)"},frozen:{label:"已冻结",color:"#ff5f5f",bg:"rgba(255,95,95,.12)"},inactive:{label:"失效",color:"#94a3b8",bg:"rgba(148,163,184,.12)"}},Lt={recharge:{label:"充值",color:"#00c758",icon:"💰"},consumption:{label:"消费",color:"#ff5f5f",icon:"💸"},refund:{label:"退款",color:"#00c758",icon:"↩️"},fee:{label:"手续费",color:"#ffb347",icon:"💵"},settle:{label:"结算",color:"#7eb8f7",icon:"📋"}};function It(e){const t=["linear-gradient(135deg,#667eea 0%,#764ba2 100%)","linear-gradient(135deg,#f093fb 0%,#f5576c 100%)","linear-gradient(135deg,#4facfe 0%,#00f2fe 100%)","linear-gradient(135deg,#43e97b 0%,#38f9d7 100%)","linear-gradient(135deg,#fa709a 0%,#fee140 100%)","linear-gradient(135deg,#30cfd0 0%,#330867 100%)"];return t[e%t.length]}function zt(e,t="$"){return e==null||isNaN(e)?`${t}0.00`:`${t}${w(e)}`}const W=/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()\-_=+\[\]{};:'",.<>/?\\|`~])[A-Za-z\d!@#$%^&*()\-_=+\[\]{};:'",.<>/?\\|`~]{8,16}$/;let Pt="",Bt="",M=!1,N=!1;const _t="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='110' height='40'%3E%3Crect width='100%25' height='100%25' fill='%231e253a'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%239da3c0' font-size='13'%3E加载中...%3C/text%3E%3C/svg%3E";function K(e){const t=e==="login";document.getElementById("tabLogin").classList.toggle("active",t),document.getElementById("tabReg").classList.toggle("active",!t),document.getElementById("loginForm").classList.toggle("hidden",!t),document.getElementById("regForm").classList.toggle("hidden",t),Z(t?"login":"reg")}async function Z(e){const t=e==="login"?"loginCaptchaImg":"regCaptchaImg",n=document.getElementById(t);n&&(n.style.opacity="0.5",n.src=_t);try{const i=await m("/auth/captcha",{method:"GET"});if(i.code!==0)return;e==="login"?Pt=i.data.token:Bt=i.data.token,n&&(n.src=i.data.image,n.style.opacity="1")}catch{n&&(n.style.opacity="1")}}function p(e,t){const n=document.getElementById(e);n&&(n.textContent=t)}function At(){const e=document.getElementById("loginEmail").value.trim(),t=document.getElementById("loginPwd").value;let n=!0;return e&&!B.test(e)?(p("loginEmailErr","邮箱格式不正确"),n=!1):p("loginEmailErr",""),t&&t.length<6?(p("loginPwdErr","密码长度不合法"),n=!1):p("loginPwdErr",""),n}function Q(){var o;const e=document.getElementById("regEmail").value.trim(),t=document.getElementById("regPwd").value,n=(o=document.getElementById("regPwd2"))==null?void 0:o.value;let i=!0;return e&&!B.test(e)?(p("regEmailErr","邮箱格式不正确"),i=!1):p("regEmailErr",""),t&&!W.test(t)?(p("regPwdErr","密码须8-16位，含大小写字母、数字及特殊字符"),i=!1):p("regPwdErr",""),n&&n!==t?(p("regPwd2Err","两次密码不一致"),i=!1):p("regPwd2Err",""),i}function I(e,t){const n=document.getElementById(e);n&&(n.className=t?"ok":"",n.textContent=(t?"✓ ":"✗ ")+n.textContent.slice(2))}function Mt(){const e=document.getElementById("regPwd").value,t=document.getElementById("pwdStrengthWrap"),n=document.getElementById("pwdStrengthFill"),i=document.getElementById("pwdStrengthLabel"),o=e.length>=8&&e.length<=16,a=/[A-Z]/.test(e),r=/\d/.test(e),s=/[!@#$%^&*()\-_=+\[\]{};:'",.<>/?\\|`~]/.test(e);if(I("r-len",o),I("r-upper",a),I("r-num",r),I("r-special",s),e.length===0){t.style.display="none";return}t.style.display="flex";const d=[o,a,r,s].filter(Boolean).length,l=[{w:"25%",bg:"#ff5f5f",t:"弱"},{w:"50%",bg:"#ffb347",t:"中"},{w:"75%",bg:"#4f8fff",t:"强"},{w:"100%",bg:"#00c758",t:"极强"}],u=l[d-1]||l[0];n.style.width=u.w,n.style.background=u.bg,i.textContent=u.t,i.style.color=u.bg,Q()}async function Nt(){if(M)return;const e=document.getElementById("loginEmail").value.trim(),t=document.getElementById("loginPwd").value;let n=!1;if(e?B.test(e)?p("loginEmailErr",""):(p("loginEmailErr","邮箱格式不正确"),n=!0):(p("loginEmailErr","邮箱不能为空"),n=!0),t?p("loginPwdErr",""):(p("loginPwdErr","密码不能为空"),n=!0),n)return;M=!0;const i=document.getElementById("loginBtn");i.disabled=!0,i.innerHTML='<span class="spinner"></span> 登录中…';try{const o=await m("/auth/login",{method:"POST",body:JSON.stringify({email:e,password:t})});if(o.code!==0){c("❌ "+(o.msg||"登录失败"));return}q(o.data.token),V(o.data.user),window.enterDash&&window.enterDash()}catch(o){o.message!=="Unauthorized"&&c("❌ "+(o.message||"连接失败"))}finally{i.disabled=!1,i.textContent="登 录",setTimeout(()=>{M=!1},500)}}async function Dt(){var r;if(N)return;const e=document.getElementById("regName").value.trim(),t=document.getElementById("regEmail").value.trim(),n=document.getElementById("regPwd").value,i=(r=document.getElementById("regPwd2"))==null?void 0:r.value;let o=!1;if(e?p("regNameErr",""):(p("regNameErr","用户名不能为空"),o=!0),t?B.test(t)?p("regEmailErr",""):(p("regEmailErr","邮箱格式不正确"),o=!0):(p("regEmailErr","邮箱不能为空"),o=!0),n?W.test(n)?p("regPwdErr",""):(p("regPwdErr","密码须8-16位，含大小写字母、数字及特殊字符"),o=!0):(p("regPwdErr","密码不能为空"),o=!0),i!==n?(p("regPwd2Err","两次密码不一致"),o=!0):p("regPwd2Err",""),o)return;N=!0;const a=document.getElementById("regBtn");a.disabled=!0,a.innerHTML='<span class="spinner"></span> 注册中…';try{const s=await m("/auth/register",{method:"POST",body:JSON.stringify({email:t,password:n,confirmPassword:i,name:e})});if(s.code!==0){c("❌ "+(s.msg||"注册失败"));return}c("✅ 注册成功，请登录"),K("login")}catch(s){s.message!=="Unauthorized"&&c("❌ 连接失败，请检查后端")}finally{a.disabled=!1,a.textContent="注 册",setTimeout(()=>{N=!1},500)}}function X(){var e,t;(e=document.getElementById("authWrap"))==null||e.classList.remove("hidden"),(t=document.getElementById("dashWrap"))==null||t.classList.add("hidden")}function Ht(){q(null),V(null),X()}function tt(){return!!T&&!!h}function et(){return(h==null?void 0:h.role)==="admin"}function jt(){return h}const H={cards:{title:"账户总览",sub:""},apply:{title:"申请开卡",sub:"选择卡段，提交开卡申请"},topup:{title:"充值",sub:"充值到账户余额，支持 USDT 等方式"},ledger:{title:"账户流水",sub:"账户资金进出记录"},"card-tx":{title:"卡交易记录",sub:"所有虚拟卡的交易明细"},"card-settle":{title:"卡结算记录",sub:"虚拟卡的结算对账记录"},"card-mgmt":{title:"卡片管理",sub:"查看和操作所有用户卡片"},"admin-dashboard":{title:"管理总览",sub:"平台数据概览"},"admin-users":{title:"用户管理",sub:"查看和管理平台用户"},"admin-fee-config":{title:"费用设置",sub:"配置全局费率，可为指定用户设置自定义费率"},"balance-detail":{title:"账务明细",sub:"账户资金构成、分类统计和余额趋势"},"admin-card-review":{title:"开卡审核",sub:"审核用户提交的开卡申请，通过后自动调用 vmcardio 开卡"},"admin-topup-review":{title:"充值审核",sub:"审核用户提交的充值申请，通过后自动入账用户余额"},"admin-settings":{title:"系统设置",sub:"配置钱包收款地址、USDT汇率等系统参数"},"admin-finance":{title:"财务中心",sub:"平台资金概览、用户余额分布、充值与费用统计"},"admin-tx-monitor":{title:"交易监控",sub:"所有用户所有卡的实时交易记录与统计"}},nt={"card-mgmt":["nav-card-mgmt","nav-admin-cards"],"admin-dashboard":["nav-admin-dashboard"],"admin-users":["nav-admin-users"],"admin-fee-config":["nav-admin-fee-config"],"admin-card-review":["nav-admin-card-review"],"admin-topup-review":["nav-admin-topup-review"],"admin-finance":["nav-admin-finance"],"admin-tx-monitor":["nav-admin-tx-monitor"],"admin-settings":["nav-admin-settings"]},_={};function Ot(e,t){_[e]=t}function it(e){Object.assign(_,e)}function L(e){localStorage.setItem("vcc_page",e);const t=document.getElementById("contentArea");t&&(t.style.paddingTop="",t.style.paddingLeft="",t.style.maxWidth=""),document.querySelectorAll(".nav-item").forEach(s=>s.classList.remove("active")),(nt[e]||["nav-"+e]).forEach(s=>{const d=document.getElementById(s);d&&d.classList.add("active")});const i=H[e]||{},o=document.getElementById("topbarTitle"),a=document.getElementById("topbarSub");o&&(o.textContent=i.title||e),a&&(a.textContent=i.sub||""),t!=null&&t.scrollTo&&t.scrollTo({top:0});const r=_[e];if(r)r();else{console.warn(`页面 "${e}" 没有注册的渲染函数`);const s=window[`render${e.charAt(0).toUpperCase()+e.slice(1)}`];s&&s()}}function Rt(){const e=localStorage.getItem("vcc_page")||"cards";L(e)}function ot(){return localStorage.getItem("vcc_page")||"cards"}function at(){return et()?"admin-dashboard":"cards"}function Ut(){const e=localStorage.getItem("vcc_page"),t=at();e&&_[e]?L(e):L(t)}function Ft(e){return t=>{t==null||t.preventDefault(),L(e)}}function st(){document.querySelectorAll("[data-page]").forEach(e=>{const t=e.dataset.page;e.addEventListener("click",Ft(t))})}function qt(e){return H[e]||{title:e,sub:""}}let z=null,k=null;async function Vt(){const e=document.getElementById("contentArea");e&&(e.innerHTML=`
    <div class="page-header">
      <div class="flex items-center justify-between">
        <div>
          <h2>账户总览</h2>
          <p class="text-muted mt-1">资产状况一目了然</p>
        </div>
        <button class="btn btn-primary" onclick="gotoPage('apply')">✨ 申请开卡</button>
      </div>
    </div>

    <div class="ov-stat-row">
      <div class="ov-stat-card">
        <div class="ov-stat-label">账户余额</div>
        <div class="ov-stat-val grad-text" id="ovBalance">$—</div>
      </div>
      <div class="ov-stat-card">
        <div class="ov-stat-label">活跃卡片</div>
        <div class="ov-stat-val grad-text" id="ovCardCount">—</div>
        <div class="ov-stat-hint">未冻结 · 未过期</div>
      </div>
    </div>

    <div class="panel mb-4">
      <div class="flex items-center justify-between mb-4">
        <div style="font-weight:700;font-size:.95rem">消费趋势</div>
        <div class="ov-tab-group">
          <button class="ov-tab active" onclick="switchOvTab(7,this)">近7天</button>
          <button class="ov-tab" onclick="switchOvTab(30,this)">近30天</button>
          <button class="ov-tab" onclick="switchOvTab(90,this)">近90天</button>
        </div>
      </div>
      <div style="position:relative;height:200px">
        <canvas id="ovChart"></canvas>
        <div id="ovChartEmpty" style="display:none;position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--text3);font-size:.85rem">暂无交易数据</div>
      </div>
    </div>

    <div class="panel">
      <div style="font-weight:700;font-size:.95rem;margin-bottom:16px">最近交易记录</div>
      <div id="ovTxList"><div class="skeleton" style="height:200px;border-radius:10px;"></div></div>
    </div>
  `,await Promise.all([Yt(),Jt(),rt(7),Wt()]))}async function Yt(){var t;const e=document.getElementById("ovBalance");if(e)try{if((h==null?void 0:h.role)==="admin"){const n=e.previousElementSibling;n&&(n.textContent="商户余额");const i=await m("/admin/stats");(i==null?void 0:i.code)===0&&((t=i==null?void 0:i.data)==null?void 0:t.merchant_balance)!=null?e.textContent="$"+w(i.data.merchant_balance):e.textContent="$—"}else{const n=await m("/cards/account/balance");e.textContent=n.code===0?"$"+w(n.data.balance):"$—"}}catch{e.textContent="$—"}}async function Jt(){const e=document.getElementById("ovCardCount");if(e)try{const t=await m("/cards");if(t.code!==0){e.textContent="—";return}const n=new Date,i=(t.data||[]).filter(o=>{if(o.error||(o.status||"").toUpperCase()!=="ACTIVE")return!1;if(o.expire){const[a,r]=o.expire.split("/");if(new Date(2e3+parseInt(r||0),parseInt(a||1)-1,1)<n)return!1}return!0});e.textContent=i.length}catch{e.textContent="—"}}async function rt(e){var d;const t=document.getElementById("ovChart");if(!t)return;if(!k)try{const l=await m("/transactions?page_size=200");k=l.code===0&&((d=l.data)!=null&&d.list)?l.data.list:[]}catch{k=[]}const n=k.filter(l=>{const u=(l.transaction_type||l.type||"").toLowerCase();return(l.status||"").toLowerCase()==="success"&&(u.includes("consume")||u.includes("spend")||u.includes("payment"))}),i=new Date,o=[],a=[];for(let l=e-1;l>=0;l--){const u=new Date(i);u.setDate(u.getDate()-l);const g=`${u.getMonth()+1}/${u.getDate()}`;o.push(g);const f=n.filter(v=>{const y=new Date(v.auth_time||v.created_at||0);return y.getFullYear()===u.getFullYear()&&y.getMonth()===u.getMonth()&&y.getDate()===u.getDate()}).reduce((v,y)=>v+Math.abs(Number(y.transaction_amount||y.amount||0)),0);a.push(parseFloat(f.toFixed(2)))}const r=a.some(l=>l>0),s=document.getElementById("ovChartEmpty");s&&(s.style.display=r?"none":"flex"),z&&(z.destroy(),z=null),typeof Chart<"u"&&(z=new Chart(t,{type:"line",data:{labels:o,datasets:[{label:"消费金额 ($)",data:a,borderColor:"#00f2fe",backgroundColor:"rgba(0,242,254,0.08)",pointBackgroundColor:"#00f2fe",pointRadius:3,pointHoverRadius:5,tension:.4,fill:!0,borderWidth:2}]},options:{responsive:!0,maintainAspectRatio:!1,plugins:{legend:{display:!1},tooltip:{backgroundColor:"#1e253a",borderColor:"rgba(0,242,254,.2)",borderWidth:1,titleColor:"#a6aabe",bodyColor:"#e1e5f9",callbacks:{label:l=>" $"+l.parsed.y.toFixed(2)}}},scales:{x:{grid:{color:"rgba(255,255,255,.04)"},ticks:{color:"#707587",font:{size:11},maxTicksLimit:e<=7?7:10}},y:{grid:{color:"rgba(255,255,255,.04)"},ticks:{color:"#707587",font:{size:11},callback:l=>"$"+l}}}}}))}function Gt(e,t){document.querySelectorAll(".ov-tab").forEach(n=>n.classList.remove("active")),t.classList.add("active"),k=null,rt(e)}async function Wt(){var n;const e=document.getElementById("ovTxList");if(!e)return;const t=`
    <div class="ov-tx-head">
      <div>卡BIN</div>
      <div>卡产品</div>
      <div>商户名称</div>
      <div>交易类型</div>
      <div>交易状态</div>
      <div style="text-align:right">交易金额</div>
      <div style="text-align:right">交易时间</div>
    </div>`;try{const i=await m("/transactions?page_size=10");if(i.code!==0||!(((n=i.data)==null?void 0:n.list)||[]).length){e.innerHTML=t+'<div style="text-align:center;padding:28px 0;color:var(--text3);font-size:.85rem">暂无交易记录</div>';return}const o={Authorization:"消费授权",Settlement:"清算",Refund:"退款",Reversal:"撤销"},a={PENDING:{cls:"tag-yellow",label:"清算中"},DECLINED:{cls:"tag-red",label:"失败"},COMPLETE:{cls:"tag-green",label:"完成"}},r=i.data.list.map(s=>{const d=(s.transaction_type||"").toString(),l=o[d]||d||"—",u=(s.status||"").toUpperCase(),g=a[u]||{cls:"tag-purple",label:u||"—"},f=(s.card_id||"").slice(0,6)||"—",v=s.product_code||"—",y=s.merchant_name||"—",b=s.amount!==void 0?Number(s.amount):null,$=b!==null&&b<0?"var(--red)":b!==null&&b>0?"var(--green)":"var(--text2)",A=s.start_time?new Date(s.start_time).toLocaleString("zh-CN",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"}):"—";return`
        <div class="ov-tx-row">
          <div class="ov-tx-cell">${f}</div>
          <div class="ov-tx-cell">${v}</div>
          <div class="ov-tx-cell ov-tx-merchant">${y}</div>
          <div class="ov-tx-cell"><span class="tag tag-blue" style="font-size:.68rem">${l}</span></div>
          <div class="ov-tx-cell"><span class="tag ${g.cls}" style="font-size:.68rem">${g.label}</span></div>
          <div class="ov-tx-cell" style="text-align:right;font-weight:700;color:${$}">
            ${b!==null?(b>=0?"+":"")+b.toFixed(2):"—"}
          </div>
          <div class="ov-tx-cell" style="text-align:right;color:var(--text3);font-size:.78rem">${A}</div>
        </div>`}).join("");e.innerHTML=t+`<div class="ov-tx-body">${r}</div>`}catch(i){i.message!=="Unauthorized"&&(e.innerHTML='<div style="color:var(--red);font-size:.85rem;padding:12px">加载失败</div>')}}typeof window<"u"&&(window.switchOvTab=Gt);let P=null,U=!1;async function Kt(){const e=document.getElementById("contentArea");e&&(e.innerHTML=`
    <div class="page-header">
      <div class="flex items-center justify-between">
        <div>
          <h2>我的卡片</h2>
          <p class="text-muted mt-1">管理您的虚拟卡</p>
        </div>
        <button class="btn btn-primary" onclick="gotoPage('apply')">✨ 申请新卡</button>
      </div>
    </div>
    <div id="cardsList" class="cards-grid">
      <div class="skeleton" style="height:200px;border-radius:16px;"></div>
      <div class="skeleton" style="height:200px;border-radius:16px;"></div>
    </div>
  `,await j())}async function j(){const e=document.getElementById("cardsList");if(e)try{U=!0;const t=await m("/cards");if(t.code!==0){e.innerHTML=`<div class="empty-state">❌ 加载失败: ${t.msg}</div>`;return}const n=t.data||[];if(P=n,n.length===0){e.innerHTML=`
        <div class="empty-state">
          <div style="font-size:48px;margin-bottom:16px">💳</div>
          <div style="color:var(--text2);margin-bottom:16px">暂无卡片</div>
          <button class="btn btn-primary" onclick="gotoPage('apply')">申请第一张卡片</button>
        </div>
      `;return}e.innerHTML=n.map((i,o)=>Zt(i,o)).join(""),n.forEach(i=>{const o=document.getElementById(`card-${i.card_id}`);o&&o.addEventListener("click",()=>dt(i.card_id))})}catch(t){t.message!=="Unauthorized"&&(e.innerHTML='<div class="empty-state">❌ 网络错误，请稍后重试</div>')}finally{U=!1}}function Zt(e,t){const n=(e.status||"").toUpperCase()==="ACTIVE",i=e.verified_status==="invalid",o=e.available_amount!==void 0?Number(e.available_amount):0,a=["linear-gradient(135deg, #667eea 0%, #764ba2 100%)","linear-gradient(135deg, #f093fb 0%, #f5576c 100%)","linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)","linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)"],r=a[t%a.length],s=(e.card_number||"****").replace(/(\d{4})(?=\d)/g,"$1 "),d=s.slice(-8).padStart(s.length,"*");return`
    <div id="card-${e.card_id}" class="card-item" style="
      background: ${r};
      border-radius: 16px;
      padding: 20px;
      cursor: pointer;
      transition: transform 0.2s, box-shadow 0.2s;
      position: relative;
      overflow: hidden;
    " onmouseenter="this.style.transform='translateY(-4px)';this.style.boxShadow='0 12px 24px rgba(0,0,0,0.3)'"
       onmouseleave="this.style.transform='';this.style.boxShadow=''">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
        <span style="font-weight:600;font-size:0.9rem;opacity:0.9">${/visa/i.test(e.card_type||"")?"VISA":"MASTERCARD"}</span>
        <span style="
          width:8px;height:8px;border-radius:50%;
          background:${n?"#00c758":i?"#94a3b8":"#ff5f5f"};
          box-shadow:0 0 8px ${n?"#00c758":i?"#94a3b8":"#ff5f5f"};
        "></span>
      </div>
      <div style="font-family:monospace;font-size:1.2rem;letter-spacing:2px;margin-bottom:20px;">
        ${d}
      </div>
      <div style="display:flex;justify-content:space-between;align-items:flex-end;">
        <div>
          <div style="font-size:0.75rem;opacity:0.7;margin-bottom:4px;">可用余额</div>
          <div style="font-size:1.3rem;font-weight:700;">$${w(o)}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:0.75rem;opacity:0.7;margin-bottom:4px;">有效期</div>
          <div style="font-size:0.9rem;">${e.expire||"--/--"}</div>
        </div>
      </div>
      ${i?'<div style="position:absolute;top:12px;right:12px;background:rgba(255,95,95,0.9);color:white;padding:4px 12px;border-radius:20px;font-size:0.75rem;font-weight:600;">已失效</div>':""}
    </div>
  `}async function dt(e){const t=P==null?void 0:P.find(r=>r.card_id===e);if(!t){c("❌ 卡片数据不存在");return}const n=(t.status||"").toUpperCase()==="ACTIVE",i=t.verified_status==="invalid",o=document.createElement("div");o.className="modal-overlay",o.style.cssText=`
    position: fixed; inset: 0; background: rgba(0,0,0,0.7);
    display: flex; align-items: center; justify-content: center;
    z-index: 10000; opacity: 0; transition: opacity 0.3s;
  `;const a=(t.card_number||"").replace(/(\d{4})(?=\d)/g,"$1 ");o.innerHTML=`
    <div style="
      background: linear-gradient(135deg, #13192a 0%, #1d2035 100%);
      border: 1px solid rgba(167,139,250,0.15);
      border-radius: 16px;
      width: 90%; max-width: 480px;
      max-height: 85vh; overflow-y: auto;
      transform: scale(0.9); transition: transform 0.3s;
    ">
      <div style="padding: 20px 24px; border-bottom: 1px solid rgba(255,255,255,0.08); display: flex; justify-content: space-between; align-items: center;">
        <h3 style="margin: 0; font-size: 1.1rem; background: linear-gradient(135deg,#7eb8f7,#a78bfa); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">卡片详情</h3>
        <button class="modal-close" style="background: none; border: none; color: var(--text2); font-size: 24px; cursor: pointer;">×</button>
      </div>
      <div style="padding: 24px;">
        <!-- 卡片预览 -->
        <div style="
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          border-radius: 12px; padding: 20px; margin-bottom: 20px;
        ">
          <div style="display: flex; justify-content: space-between; margin-bottom: 16px;">
            <span style="font-weight: 600;">${/visa/i.test(t.card_type||"")?"VISA":"MASTERCARD"}</span>
            <span style="width: 8px; height: 8px; border-radius: 50%; background: ${n?"#00c758":"#ff5f5f"};"></span>
          </div>
          <div style="font-family: monospace; font-size: 1.1rem; letter-spacing: 2px; margin-bottom: 16px;">
            ${a||"**** **** **** ****"}
          </div>
          <div style="display: flex; justify-content: space-between;">
            <div>
              <div style="font-size: 0.7rem; opacity: 0.8;">持卡人</div>
              <div style="font-size: 0.85rem;">${t.first_name||""} ${t.last_name||""}</div>
            </div>
            <div style="text-align: center;">
              <div style="font-size: 0.7rem; opacity: 0.8;">CVV</div>
              <div style="font-size: 0.85rem; filter: blur(4px); cursor: pointer;" onclick="this.style.filter=this.style.filter?'':'blur(4px)'">${t.cvv||"***"}</div>
            </div>
            <div style="text-align: right;">
              <div style="font-size: 0.7rem; opacity: 0.8;">有效期</div>
              <div style="font-size: 0.85rem;">${t.expire||"--/--"}</div>
            </div>
          </div>
        </div>

        <!-- 详细信息 -->
        <div style="margin-bottom: 20px;">
          ${S("Card ID",t.card_id,!0)}
          ${S("卡类型",t.card_type)}
          ${S("状态",n?"✅ 正常":i?"❌ 已失效":"🔒 已冻结")}
          ${S("可用余额","$"+w(t.available_amount))}
          ${t.card_address?S("地址",[t.card_address.address_line_one,t.card_address.city,t.card_address.country].filter(Boolean).join(", ")):""}
        </div>

        <!-- 操作按钮 -->
        <div style="display: flex; gap: 12px;">
          ${i?"":`<button class="btn btn-primary flex-1" onclick="rechargeCard('${t.card_id}')">💰 充值</button>`}
          ${i?"":`<button class="btn btn-outline flex-1" onclick="toggleCardFreeze('${t.card_id}', '${t.status}')">${n?"🔒 冻结":"🔓 解冻"}</button>`}
          <button class="btn btn-outline" onclick="copyVal('${t.card_number}')">📋 复制卡号</button>
        </div>
      </div>
    </div>
  `,document.body.appendChild(o),requestAnimationFrame(()=>{o.style.opacity="1",o.querySelector("div > div").style.transform="scale(1)"}),o.querySelector(".modal-close").addEventListener("click",()=>{o.style.opacity="0",setTimeout(()=>o.remove(),300)}),o.addEventListener("click",r=>{r.target===o&&(o.style.opacity="0",setTimeout(()=>o.remove(),300))})}function S(e,t,n=!1){return t==null||t===""?"":`
    <div style="display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">
      <span style="color: var(--text2); font-size: 0.85rem;">${e}</span>
      <span style="font-family: ${n?"monospace":"inherit"}; font-size: 0.9rem; font-weight: 500;">${t}</span>
    </div>
  `}async function Qt(e){const t=prompt("请输入充值金额（USD）：","100");if(!t||isNaN(t)||t<=0){c("⚠️ 请输入有效金额");return}if(parseFloat(t)<10){c("⚠️ 最低充值 $10");return}try{const n=await m(`/cards/${e}/recharge`,{method:"POST",body:JSON.stringify({amount:parseFloat(t)})});if(n.code!==0){c("❌ "+(n.msg||"充值失败"));return}c(`✅ 充值 $${t} 成功`),await j()}catch(n){n.message!=="Unauthorized"&&c("❌ 充值失败")}}async function Xt(e,t){const i=String(t).toUpperCase()==="CANCELLED"?"ACTIVE":"CANCELLED",o=i==="CANCELLED"?"冻结":"解冻";if(confirm(`确认要${o}该卡片吗？`))try{const a=await m(`/cards/${e}/freeze`,{method:"POST",body:JSON.stringify({status:i})});if(a.code!==0){c("❌ "+(a.msg||`${o}失败`));return}c(`✅ 卡片已${o}`),await j()}catch(a){a.message!=="Unauthorized"&&c("❌ 操作失败")}}typeof window<"u"&&(window.showCardDetail=dt,window.rechargeCard=Qt,window.toggleCardFreeze=Xt);let x=null,E=null;async function te(){const e=document.getElementById("contentArea");if(!e)return;e.innerHTML=`
    <div class="page-header">
      <div class="flex items-center justify-between">
        <div>
          <h2>申请开卡</h2>
          <p class="text-muted mt-1">选择卡段，提交开卡申请</p>
        </div>
      </div>
    </div>

    <div class="panel">
      <div style="font-weight:700;font-size:1rem;margin-bottom:20px;">选择卡类型</div>
      <div id="cardTypesList" class="card-types-grid">
        <div class="skeleton" style="height:120px;border-radius:12px;"></div>
        <div class="skeleton" style="height:120px;border-radius:12px;"></div>
        <div class="skeleton" style="height:120px;border-radius:12px;"></div>
      </div>
    </div>

    <div class="panel" id="applyFormPanel" style="display:none;">
      <div style="font-weight:700;font-size:1rem;margin-bottom:20px;">填写申请信息</div>
      <form id="applyForm">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">
          <div class="form-group">
            <label>姓氏</label>
            <input type="text" id="applyFirstName" class="form-control" placeholder="如: Zhang" required>
          </div>
          <div class="form-group">
            <label>名字</label>
            <input type="text" id="applyLastName" class="form-control" placeholder="如: San" required>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">
          <div class="form-group">
            <label>充值金额 (USD)</label>
            <input type="number" id="applyAmount" class="form-control" placeholder="最低 $10" min="10" step="0.01" required>
            <div style="font-size:0.75rem;color:var(--text2);margin-top:4px;">开卡费: $<span id="applyFee">0</span></div>
          </div>
          <div class="form-group">
            <label>有效期 (月)</label>
            <select id="applyMonths" class="form-control">
              <option value="12">12个月</option>
              <option value="24">24个月</option>
              <option value="36">36个月</option>
            </select>
          </div>
        </div>

        <div class="form-group">
          <label>用途说明</label>
          <textarea id="applyPurpose" class="form-control" rows="2" placeholder="请简要说明卡片用途..."></textarea>
        </div>

        <div style="display:flex;justify-content:flex-end;gap:12px;margin-top:24px;">
          <button type="button" class="btn btn-outline" onclick="gotoPage('cards')">取消</button>
          <button type="submit" class="btn btn-primary" id="applySubmitBtn">提交申请</button>
        </div>
      </form>
    </div>
  `;const t=document.getElementById("applyForm");t&&t.addEventListener("submit",ie),await ee()}async function ee(){const e=document.getElementById("cardTypesList");if(e)try{if(E){F(E);return}const t=await m("/card-types");if(t.code!==0){e.innerHTML=`<div class="empty-state">❌ 加载失败: ${t.msg}</div>`;return}E=t.data||[],F(E)}catch(t){t.message!=="Unauthorized"&&(e.innerHTML='<div class="empty-state">❌ 网络错误</div>')}}function F(e){const t=document.getElementById("cardTypesList");if(t){if(e.length===0){t.innerHTML='<div class="empty-state">暂无可用卡类型</div>';return}t.innerHTML=e.map(n=>`
    <div class="card-type-item ${n.id===(x==null?void 0:x.id)?"selected":""}"
         data-id="${n.id}"
         onclick="selectCardType('${n.id}')"
         style="
           background: linear-gradient(135deg, ${n.bg_color||"#667eea"} 0%, ${n.accent_color||"#764ba2"} 100%);
           border-radius: 12px;
           padding: 16px;
           cursor: pointer;
           border: 2px solid ${n.id===(x==null?void 0:x.id)?"#00f2fe":"transparent"};
           transition: all 0.2s;
         ">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <span style="font-weight:600;">${n.name}</span>
        <span style="font-size:0.75rem;opacity:0.8;">${n.card_brand||"VISA"}</span>
      </div>
      <div style="font-size:0.8rem;opacity:0.9;margin-bottom:4px;">开卡费: $${w(n.open_fee)}</div>
      <div style="font-size:0.75rem;opacity:0.7;">${n.description||""}</div>
    </div>
  `).join("")}}function ne(e){const t=E==null?void 0:E.find(o=>o.id===e);if(!t)return;x=t,document.querySelectorAll(".card-type-item").forEach(o=>{o.style.border=o.dataset.id===e?"2px solid #00f2fe":"2px solid transparent"});const n=document.getElementById("applyFormPanel");n&&(n.style.display="block",n.scrollIntoView({behavior:"smooth"}));const i=document.getElementById("applyFee");i&&(i.textContent=w(t.open_fee))}async function ie(e){if(e.preventDefault(),!x){c("⚠️ 请先选择卡类型");return}const t=document.getElementById("applyFirstName").value.trim(),n=document.getElementById("applyLastName").value.trim(),i=parseFloat(document.getElementById("applyAmount").value),o=parseInt(document.getElementById("applyMonths").value),a=document.getElementById("applyPurpose").value.trim();if(!t||!n){c("⚠️ 请填写姓名");return}if(!i||i<10){c("⚠️ 充值金额最低 $10");return}const r=document.getElementById("applySubmitBtn");r.disabled=!0,r.innerHTML='<span class="spinner"></span> 提交中...';try{const s=await m("/cards/apply",{method:"POST",body:JSON.stringify({card_type_id:x.id,first_name:t,last_name:n,amount:i,months:o,purpose:a})});if(s.code!==0){c("❌ "+(s.msg||"申请失败"));return}c("✅ 申请提交成功！"),gotoPage("cards")}catch(s){s.message!=="Unauthorized"&&c("❌ 申请失败")}finally{r.disabled=!1,r.textContent="提交申请"}}typeof window<"u"&&(window.selectCardType=ne);let C="usdt";async function oe(){const e=document.getElementById("contentArea");if(!e)return;e.innerHTML=`
    <div class="page-header">
      <div class="flex items-center justify-between">
        <div>
          <h2>充值中心</h2>
          <p class="text-muted mt-1">充值到账户余额，支持 USDT 等方式</p>
        </div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
      <!-- 充值方式 -->
      <div class="panel">
        <div style="font-weight:700;font-size:1rem;margin-bottom:20px;">选择充值方式</div>

        <div class="topup-method-list">
          <div class="topup-method-item ${C==="usdt"?"selected":""}"
               onclick="selectTopupMethod('usdt')"
               style="
                 display:flex;align-items:center;gap:12px;
                 padding:16px;border-radius:12px;
                 border:2px solid ${C==="usdt"?"#00f2fe":"rgba(255,255,255,0.1)"};
                 background:rgba(255,255,255,0.03);
                 cursor:pointer;transition:all 0.2s;
                 margin-bottom:12px;
               ">
            <div style="width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#26a17b,#2ecc71);display:flex;align-items:center;justify-content:center;font-size:1.2rem;">💎</div>
            <div style="flex:1;">
              <div style="font-weight:600;">USDT (TRC20)</div>
              <div style="font-size:0.75rem;color:var(--text2);">支持 Tron 网络转账</div>
            </div>
            <div style="color:#00c758;font-weight:600;">推荐</div>
          </div>

          <div class="topup-method-item ${C==="bank"?"selected":""}"
               onclick="selectTopupMethod('bank')"
               style="
                 display:flex;align-items:center;gap:12px;
                 padding:16px;border-radius:12px;
                 border:2px solid ${C==="bank"?"#00f2fe":"rgba(255,255,255,0.1)"};
                 background:rgba(255,255,255,0.03);
                 cursor:pointer;transition:all 0.2s;
                 opacity:0.5;
               ">
            <div style="width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#4facfe,#00f2fe);display:flex;align-items:center;justify-content:center;font-size:1.2rem;">🏦</div>
            <div style="flex:1;">
              <div style="font-weight:600;">银行转账</div>
              <div style="font-size:0.75rem;color:var(--text2);">即将上线</div>
            </div>
          </div>
        </div>
      </div>

      <!-- 充值表单 -->
      <div class="panel">
        <div style="font-weight:700;font-size:1rem;margin-bottom:20px;">填写充值信息</div>

        <form id="topupForm">
          <div class="form-group" style="margin-bottom:16px;">
            <label>充值金额 (USD)</label>
            <input type="number" id="topupAmount" class="form-control" placeholder="请输入金额" min="10" step="0.01" required>
            <div style="font-size:0.75rem;color:var(--text2);margin-top:4px;">最低充值 $10，汇率 1 USDT = 1 USD</div>
          </div>

          <div class="form-group" style="margin-bottom:16px;">
            <label>交易哈希 (TxHash)</label>
            <input type="text" id="topupTxHash" class="form-control" placeholder="转账完成后请输入交易哈希" required>
            <div style="font-size:0.75rem;color:var(--text2);margin-top:4px;">用于确认您的转账</div>
          </div>

          <div class="form-group" style="margin-bottom:20px;">
            <label>备注 (可选)</label>
            <input type="text" id="topupRemark" class="form-control" placeholder="如有备注请填写">
          </div>

          <!-- 充值地址显示 -->
          <div style="background:rgba(0,0,0,0.2);border-radius:12px;padding:16px;margin-bottom:20px;">
            <div style="font-size:0.8rem;color:var(--text2);margin-bottom:8px;">收款地址 (USDT-TRC20)</div>
            <div style="display:flex;gap:8px;align-items:center;">
              <code id="usdtAddress" style="flex:1;background:rgba(0,0,0,0.3);padding:12px;border-radius:8px;font-size:0.85rem;word-break:break-all;">加载中...</code>
              <button type="button" class="btn btn-sm btn-outline" onclick="copyUsdtAddress()">复制</button>
            </div>
          </div>

          <button type="submit" class="btn btn-primary btn-block" id="topupSubmitBtn" style="width:100%;">
            提交充值申请
          </button>
        </form>
      </div>
    </div>

    <!-- 充值记录 -->
    <div class="panel" style="margin-top:20px;">
      <div style="font-weight:700;font-size:1rem;margin-bottom:16px;">充值记录</div>
      <div id="topupHistory">
        <div class="skeleton" style="height:100px;border-radius:12px;"></div>
      </div>
    </div>
  `;const t=document.getElementById("topupForm");t&&t.addEventListener("submit",de),await Promise.all([se(),lt()])}function ae(e){if(e==="bank"){c("⚠️ 银行转账即将上线");return}C=e,document.querySelectorAll(".topup-method-item").forEach(t=>{const n=t.getAttribute("onclick").includes(`'${e}'`);t.style.border=n?"2px solid #00f2fe":"2px solid rgba(255,255,255,0.1)",t.classList.toggle("selected",n)})}async function se(){var t;const e=document.getElementById("usdtAddress");if(e)try{const n=await m("/settings/usdt-address");n.code===0&&((t=n.data)!=null&&t.address)?e.textContent=n.data.address:e.textContent="地址获取失败，请联系客服"}catch{e.textContent="地址获取失败"}}async function re(){var t;const e=(t=document.getElementById("usdtAddress"))==null?void 0:t.textContent;if(!e||e.includes("失败")){c("⚠️ 地址不可用");return}try{await navigator.clipboard.writeText(e),c("✅ 地址已复制")}catch{c("❌ 复制失败")}}async function de(e){e.preventDefault();const t=parseFloat(document.getElementById("topupAmount").value),n=document.getElementById("topupTxHash").value.trim(),i=document.getElementById("topupRemark").value.trim();if(!t||t<10){c("⚠️ 最低充值 $10");return}if(!n){c("⚠️ 请输入交易哈希");return}const o=document.getElementById("topupSubmitBtn");o.disabled=!0,o.innerHTML='<span class="spinner"></span> 提交中...';try{const a=await m("/topup/apply",{method:"POST",body:JSON.stringify({amount:t,tx_hash:n,method:C,remark:i})});if(a.code!==0){c("❌ "+(a.msg||"提交失败"));return}c("✅ 充值申请已提交，等待审核"),document.getElementById("topupAmount").value="",document.getElementById("topupTxHash").value="",document.getElementById("topupRemark").value="",await lt()}catch(a){a.message!=="Unauthorized"&&c("❌ 提交失败")}finally{o.disabled=!1,o.textContent="提交充值申请"}}async function lt(){var t;const e=document.getElementById("topupHistory");if(e)try{const n=await m("/topup/history?page_size=5");if(n.code!==0||!(((t=n.data)==null?void 0:t.list)||[]).length){e.innerHTML='<div style="text-align:center;padding:20px;color:var(--text2);">暂无充值记录</div>';return}const i={pending:{text:"待审核",color:"#ffb347"},approved:{text:"已通过",color:"#00c758"},rejected:{text:"已拒绝",color:"#ff5f5f"}};e.innerHTML=`
      <table class="data-table">
        <thead>
          <tr>
            <th>时间</th>
            <th>金额</th>
            <th>方式</th>
            <th>状态</th>
            <th>备注</th>
          </tr>
        </thead>
        <tbody>
          ${n.data.list.map(o=>{var r;const a=i[o.status]||{text:o.status,color:"var(--text2)"};return`
              <tr>
                <td>${new Date(o.created_at).toLocaleString("zh-CN")}</td>
                <td>$${w(o.amount)}</td>
                <td>${((r=o.method)==null?void 0:r.toUpperCase())||"-"}</td>
                <td><span style="color:${a.color}">${a.text}</span></td>
                <td>${o.remark||"-"}</td>
              </tr>
            `}).join("")}
        </tbody>
      </table>
    `}catch(n){n.message!=="Unauthorized"&&(e.innerHTML='<div style="text-align:center;padding:20px;color:var(--red);">加载失败</div>')}}typeof window<"u"&&(window.selectTopupMethod=ae,window.copyUsdtAddress=re);function le(){it({overview:Vt,cards:Kt,apply:te,topup:oe}),console.log("[VCC Dashboard] 已注册页面:",Object.keys({overview:!0,cards:!0,apply:!0,topup:!0}).join(", "))}window.apiFetch=m;window.api=ft;window.toast=c;window.showToast=Y;window.Modal=D;window.confirmModal=vt;window.alertModal=yt;window.Table=J;window.createTable=ht;window.Pagination=G;window.createPagination=bt;window.copyVal=xt;window.togglePwd=Et;window.focusNext=$t;window.formatNumber=w;window.formatDate=Ct;window.formatCurrency=zt;window.cardGradClass=It;window.CARD_STATUS_MAP=kt;window.TX_TYPE_MAP=Lt;window.debounce=Tt;window.throttle=St;window.switchTab=K;window.refreshCaptcha=Z;window.validateLoginField=At;window.validateRegField=Q;window.onRegPwdInput=Mt;window.doLogin=Nt;window.doRegister=Dt;window.showAuth=X;window.doLogout=Ht;window.isAuthenticated=tt;window.isAdmin=et;window.getCurrentUser=jt;window.PAGE_META=H;window.PAGE_NAV_MAP=nt;window.gotoPage=L;window.refreshPage=Rt;window.getCurrentPage=ot;window.getDefaultPage=at;window.initRouter=Ut;window.bindNavEvents=st;window.getPageMeta=qt;window.registerPage=Ot;window.registerPages=it;window._token=T;window._me=h;window._curPage=ot();function ce(){console.log("[VCC Dashboard] 新模块化系统已加载 v2.0"),le(),window.performance&&window.addEventListener("load",()=>{const e=performance.timing,t=e.loadEventEnd-e.navigationStart;console.log(`[Performance] 页面加载时间: ${t}ms`)}),window.addEventListener("error",e=>{console.error("[Global Error]",e.error)}),window.addEventListener("unhandledrejection",e=>{console.error("[Unhandled Promise Rejection]",e.reason)}),st(),tt()&&console.log("[VCC Dashboard] 用户已登录，初始化路由")}document.addEventListener("DOMContentLoaded",ce);
