export const nginxConfig = String.raw`    include /etc/nginx/conf.d/https.ssl;
    location ~ /cache(/.*) {
        allow        all;
        #deny        all;end
        # proxy_cache_purge cache_one $host$1$is_args$args;
    }

    #cache file
    location ~ .*\.(gif|jpg|jpeg|png|bmp|swf)(.*) {
        expires 30d;
        proxy_redirect off;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Real-PORT $remote_port;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        #proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Cookie $http_cookie;
        proxy_ignore_headers X-Accel-Expires Expires Cache-Control Set-Cookie;
        proxy_cache cache_one;
        proxy_cache_key $host$uri$is_args$args;
        proxy_cache_valid 200 206 301 302 304 7d;
        add_header Cache "$upstream_cache_status";
        proxy_pass https://httpsbackend;
    }

    include /etc/nginx/conf.d/proxy.pass;

    error_page  500 502 503 504 /50x.html;
    #error_page  400 404 /50x.html;

    location = /50x.html{
            root /usr/share/nginx/html;
    }
    access_log off;`
