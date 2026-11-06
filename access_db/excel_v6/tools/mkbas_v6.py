import re
s=open('formcode_v6.txt',encoding='utf-8').read()
s=s.replace('〜','～')
bad=[]
for c in set(s):
    try: c.encode('cp932')
    except Exception: bad.append(c)
print('cp932不可:',bad)
lines=s.rstrip('\n').split('\n')
def esc(l): return l.rstrip('\r').replace('"','""')
CH=70
funcs=[]
for k in range(0,len(lines),CH):
    chunk=lines[k:k+CH]; n=k//CH+1
    body=''.join('    s = s & "%s" & vbCrLf\n'%esc(l) for l in chunk)
    funcs.append('Private Function FC%d() As String\n    Dim s As String\n%s    FC%d = s\nEnd Function\n'%(n,body,n))
nf=len(funcs)
cat=' & '.join('FC%d()'%i for i in range(1,nf+1))
head=open('bas_head.txt',encoding='utf-8').read().replace('@@CAT@@',cat)
rest=open('macros_v3.utf8',encoding='utf-8').read()
rest=rest[rest.index("' 入力フォームを開く"):]
out=head+rest.rstrip('\n')+'\n\n'+'\n'.join(funcs)
open('macros_v4.utf8','w',encoding='utf-8').write(out)
open('KensyutsuMacros_v4.bas','wb').write(out.replace('\n','\r\n').encode('cp932'))
print('functions',nf,'lines',len(lines),'size',len(out.encode('cp932')))
rebuilt=[]
for f in funcs:
    for m in re.finditer(r'    s = s & "(.*)" & vbCrLf',f): rebuilt.append(m.group(1).replace('""','"'))
print('round-trip ok:',rebuilt==[l.rstrip('\r') for l in lines])
print('max line',max(len(l) for l in out.split('\n')))
