"""Focus only the owned XWayland workbench before native keyboard/Undo assertions."""
from ctypes import CDLL,Structure,Union,POINTER,byref,c_int,c_long,c_ulong,c_void_p,c_char_p
from ctypes.util import find_library
import subprocess,sys,time
pid=int(sys.argv[1]);width=int(sys.argv[2]);height=int(sys.argv[3]);assert pid>0
x=CDLL(find_library('X11'));x.XOpenDisplay.restype=c_void_p;d=x.XOpenDisplay(None);assert d
x.XDefaultRootWindow.argtypes=[c_void_p];x.XDefaultRootWindow.restype=c_ulong;root=x.XDefaultRootWindow(d)
ids=subprocess.check_output(['xprop','-root','_NET_CLIENT_LIST'],text=True).split('#',1)[-1].replace(',','').split();matches=[]
for value in ids:
 if not value.startswith('0x'):continue
 meta=subprocess.check_output(['xprop','-id',value,'_NET_WM_PID','WM_CLASS'],text=True)
 if f'= {pid}\n' not in meta:continue
 assert any(name in meta for name in ['Code','code','VSCodium','codium']),meta
 info=subprocess.check_output(['xwininfo','-id',value],text=True)
 if f'Width: {width}\n' in info and f'Height: {height}\n' in info:matches.append(int(value,0))
assert len(matches)==1,(pid,width,height,matches)
class Data(Union):_fields_=[('l',c_long*5)]
class Client(Structure):_fields_=[('type',c_int),('serial',c_ulong),('send_event',c_int),('display',c_void_p),('window',c_ulong),('message_type',c_ulong),('format',c_int),('data',Data)]
class Event(Union):_fields_=[('client',Client),('pad',c_long*24)]
x.XInternAtom.argtypes=[c_void_p,c_char_p,c_int];x.XInternAtom.restype=c_ulong;x.XSendEvent.argtypes=[c_void_p,c_ulong,c_int,c_long,POINTER(Event)];x.XSync.argtypes=[c_void_p,c_int]
e=Event();e.client.type=33;e.client.send_event=1;e.client.display=d;e.client.window=matches[0];e.client.message_type=x.XInternAtom(d,b'_NET_ACTIVE_WINDOW',0);e.client.format=32;e.client.data.l[0]=2
x.XSendEvent(d,root,0,(1<<19)|(1<<20),byref(e));x.XSync(d,0);time.sleep(.2)
print('focused-owned-main-workbench')
