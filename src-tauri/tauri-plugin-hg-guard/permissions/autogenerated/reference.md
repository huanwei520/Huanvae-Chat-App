## Default Permission

hg-guard 插件默认权限：允许全部 6 条命令面（hg_status/hg_connect/hg_disconnect/hg_prepare_vpn/hg_control_start/hg_control_stop）。

#### This default permission set includes the following:

- `allow-hg-status`
- `allow-hg-connect`
- `allow-hg-disconnect`
- `allow-hg-prepare-vpn`
- `allow-hg-control-start`
- `allow-hg-control-stop`

## Permission Table

<table>
<tr>
<th>Identifier</th>
<th>Description</th>
</tr>


<tr>
<td>

`hg-guard:allow-hg-connect`

</td>
<td>

Enables the hg_connect command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`hg-guard:deny-hg-connect`

</td>
<td>

Denies the hg_connect command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`hg-guard:allow-hg-control-start`

</td>
<td>

Enables the hg_control_start command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`hg-guard:deny-hg-control-start`

</td>
<td>

Denies the hg_control_start command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`hg-guard:allow-hg-control-stop`

</td>
<td>

Enables the hg_control_stop command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`hg-guard:deny-hg-control-stop`

</td>
<td>

Denies the hg_control_stop command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`hg-guard:allow-hg-disconnect`

</td>
<td>

Enables the hg_disconnect command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`hg-guard:deny-hg-disconnect`

</td>
<td>

Denies the hg_disconnect command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`hg-guard:allow-hg-prepare-vpn`

</td>
<td>

Enables the hg_prepare_vpn command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`hg-guard:deny-hg-prepare-vpn`

</td>
<td>

Denies the hg_prepare_vpn command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`hg-guard:allow-hg-status`

</td>
<td>

Enables the hg_status command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`hg-guard:deny-hg-status`

</td>
<td>

Denies the hg_status command without any pre-configured scope.

</td>
</tr>
</table>
