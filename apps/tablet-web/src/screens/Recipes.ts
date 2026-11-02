import {el,field,select,panel,list,tr,button,act,summary,type ScreenContext} from '../ui';
import type {JsonObject} from '../../../../packages/contracts/src/index';
/** One line per ingredient: `ingredientId quantity [unit]`, e.g. `rice-raw 200 g`. */
export function parseRecipeLines(text:string):JsonObject[] {
 return text.split('\n').map(l=>l.trim()).filter(Boolean).map(l=>{const [ingredientId,quantity,unit]=l.split(/\s+/);return {ingredientId:ingredientId!,quantity:quantity??'',...(unit?{unit}:{})};});
}
export function Recipes(c:ScreenContext) {
 const root=el('div',undefined,'screen-grid'),menu=list(c,'catalog').find(s=>s.ref.id==='current'),items=((menu?.state.items??[]) as JsonObject[]).map(i=>({id:String(i.id),name:String(i.name??i.id)}));
 const pointers=new Map(list(c,'recipe-pointer').map(p=>[p.ref.id,String(p.state.recipeVersion)]));
 for(const recipe of list(c,'recipe').sort((a,b)=>String(b.state.publishedAt).localeCompare(String(a.state.publishedAt)))){
  const row=summary(recipe),current=pointers.get(String(recipe.state.itemId))===recipe.ref.id;
  row.append(el('p',`${String(recipe.state.itemId)} · ${current?tr(c,'đang dùng','current'):tr(c,'bản cũ (giữ nguyên cho đơn đã làm)','older (kept for past sales)')}`,current?'':'muted'),
   el('p',(recipe.state.lines as JsonObject[]).map(l=>`${String(l.ingredientId)} ${String(l.quantity)} ${String(l.unit)}`).join(' · '),'muted'));
  root.append(row);
 }
 if(!root.children.length)root.append(el('p',tr(c,'Chưa có công thức.','No recipes yet.')));
 const item=select(tr(c,'Món','Item'),items),version=field(tr(c,'Mã phiên bản (không sửa được sau khi phát hành)','Version id (immutable once published)')),lines=el('textarea');lines.rows=4;lines.setAttribute('aria-label',tr(c,'Định lượng, mỗi dòng: nguyên liệu số lượng đơn vị','Lines: ingredient quantity unit'));
 root.append(item.node,version.node,lines,button(tr(c,'Phát hành công thức','Publish recipe'),()=>act(c,'Recipe.Publish',{recipeVersion:version.input.value,itemId:item.input.value,lines:parseRecipeLines(lines.value)}).then(()=>{})));
 return panel(tr(c,'Công thức và định lượng','Recipes and quantities'),root);
}
