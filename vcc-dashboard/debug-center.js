// 在浏览器控制台执行这段代码来实时调试垂直居中

// 方法1: 给cm-card-right添加边框线便于观察
function debugShowBorders() {
  document.querySelectorAll('.cm-card-right').forEach(el => {
    el.style.border = '1px dashed red';
    el.style.position = 'relative';
  });
  console.log('已添加红色虚线边框到cm-card-right');
}

// 方法2: 强制垂直居中
function forceCenter() {
  document.querySelectorAll('.cm-card-right').forEach(el => {
    el.style.display = 'flex';
    el.style.alignItems = 'center';
    el.style.justifyContent = 'center';
    el.style.height = '100%';
  });
  
  document.querySelectorAll('.cm-bal').forEach(el => {
    el.style.display = 'flex';
    el.style.flexDirection = 'column';
    el.style.justifyContent = 'center';
    el.style.height = 'auto';
  });
  
  document.querySelectorAll('.cm-actions-row').forEach(el => {
    el.style.display = 'flex';
    el.style.alignItems = 'center';
    el.style.height = 'auto';
  });
  
  console.log('已强制垂直居中');
}

// 方法3: 重置为顶部对齐（对比效果）
function resetToTop() {
  document.querySelectorAll('.cm-card-right').forEach(el => {
    el.style.alignItems = 'flex-start';
  });
  console.log('已重置为顶部对齐');
}

// 方法4: 显示所有元素的高度
function showHeights() {
  document.querySelectorAll('.cm-card').forEach((card, i) => {
    const right = card.querySelector('.cm-card-right');
    const bal = card.querySelector('.cm-bal');
    const actions = card.querySelector('.cm-actions-row');
    
    console.log(`卡片${i+1}:`, {
      cardHeight: card.offsetHeight,
      rightHeight: right?.offsetHeight,
      balHeight: bal?.offsetHeight,
      actionsHeight: actions?.offsetHeight
    });
  });
}

console.log('调试工具已加载！可用函数：');
console.log('debugShowBorders() - 添加红色边框便于观察');
console.log('forceCenter() - 强制垂直居中');
console.log('resetToTop() - 重置为顶部对齐');
console.log('showHeights() - 显示各元素高度');
