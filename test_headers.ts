const headers = new Headers();
headers.set('LOCAL_DEV_AUTH_BYPASS', 'true');
console.log(headers.get('LOCAL_DEV_AUTH_BYPASS'));
console.log(headers.get('local-dev-auth-bypass'));
