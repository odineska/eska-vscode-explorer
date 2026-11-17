# 1C standard picture variants

Original PNG responses from the 1C:Enterprise 8.3.27.2342 web client in the
Taxi interface, variant 16, left to right. Each named `StdPicture` was assigned
to a picture decoration in a local Designer XML gallery. The runtime associated
its collection ID with an image request to `e1cib/pictureCollection/picture`.
The eight variants use `scale=85,100,125,150,175,200,300,400` and are stored
unchanged. `SHA256SUMS` records their source hashes.

Only pictures within one channel value of the Linux desktop reference at 100%
are included. The comparison uses premultiplied RGBA and composition over white.
At 100% form zoom the renderer still uses the desktop reference.

| StdPicture | Collection ID | Maximum RGBA delta | Maximum RGB delta on white |
| --- | --- | ---: | ---: |
| `CheckAll` | `-10` | 1 | 1 |
| `DeleteListItemDirectly` | `0_6cbf8f9a-3d2f-427b-bfce-5e2bc7a8589d` | 1 | 1 |
| `EventLog` | `0_723765ab-0b92-4745-a621-1ba0f77c92c9` | 1 | 1 |
| `ExchangePlan` | `0_544fdbe8-5956-4512-bc62-93b4c022d291` | 1 | 1 |
| `MoveLeft` | `-8` | 1 | 1 |
| `OpenFile` | `0_785362cb-3756-48ed-87d2-292ded17054a` | 1 | 1 |
| `Post` | `0_20ebc47b-f4d9-439c-acd3-fdc624fbac2a` | 1 | 1 |
| `Refresh` | `0_fc4f29e0-d168-4fe0-8e64-e982fabf2595` | 1 | 1 |
| `UncheckAll` | `-11` | 1 | 1 |
