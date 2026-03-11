cmd_Release/obj.target/lzo_addon/minilzo.o := cc -o Release/obj.target/lzo_addon/minilzo.o ../minilzo.c '-DNODE_GYP_MODULE_NAME=lzo_addon' '-DUSING_UV_SHARED=1' '-DUSING_V8_SHARED=1' '-DV8_DEPRECATION_WARNINGS=1' '-D_GLIBCXX_USE_CXX11_ABI=1' '-D_FILE_OFFSET_BITS=64' '-D_DARWIN_USE_64_BIT_INODE=1' '-D_LARGEFILE_SOURCE' '-DOPENSSL_NO_PINSHARED' '-DOPENSSL_THREADS' '-DBUILDING_NODE_EXTENSION' -I/Users/murtagy/Library/Caches/node-gyp/22.17.0/include/node -I/Users/murtagy/Library/Caches/node-gyp/22.17.0/src -I/Users/murtagy/Library/Caches/node-gyp/22.17.0/deps/openssl/config -I/Users/murtagy/Library/Caches/node-gyp/22.17.0/deps/openssl/openssl/include -I/Users/murtagy/Library/Caches/node-gyp/22.17.0/deps/uv/include -I/Users/murtagy/Library/Caches/node-gyp/22.17.0/deps/zlib -I/Users/murtagy/Library/Caches/node-gyp/22.17.0/deps/v8/include -I../.  -O3 -gdwarf-2 -fno-strict-aliasing -mmacosx-version-min=11.0 -arch arm64 -Wall -Wendif-labels -W -Wno-unused-parameter  -MMD -MF ./Release/.deps/Release/obj.target/lzo_addon/minilzo.o.d.raw -I/usr/local/opt/openssl@3/include  -c
Release/obj.target/lzo_addon/minilzo.o: ../minilzo.c ../minilzo.h \
  ../lzodefs.h ../lzoconf.h
../minilzo.c:
../minilzo.h:
../lzodefs.h:
../lzoconf.h:
