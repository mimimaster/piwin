## 这是啥？
其实就是devin(原windsurf)的fast-context，它是**智能体驱动的语义检索（Agentic Semantic Search）**，可以简单理解为代码语义检索工具，这个跟传统的基于向量的代码检索工具有所不同，这个要简单的多，基本上就是派个子代理出去理解代码之间的逻辑理解关系，同时又不会污染上下文（子代理的功劳），这个其实跟codex ultra code的scout是一个意思，可以看下L站佬友的文章：https://linux.do/t/topic/2578075
## 有什么好处？
上面说了，防止上下文污染，这是我的简单理解，下面这是由AI总结的，估计是从Devin官方捞的：
![image.png](https://img.yorickjue.com/file/1789905187452_image.png)
## 数据佐证：
![image.png](https://img.yorickjue.com/file/1789905406171_image.png)
## 实现：
我基本上失去动脑和动手的能力了，这边是通过深入研究Devin的二进制源码，其实L站上也有大佬有提供fast-context的mcp，我个人觉得使用频率不如devin中的fast-context，强行实现了一个；
## 使用：
【设置】->【代码搜索】
 可以自行选择是使用模型还是用devin的官方token【推荐】二选一， 模型的话建议使用首字延迟低，tps快的模型；如果用devin官方的话，是需要你去挖个自己devin账号的devin-key的，这个是免费的，后续会说到，这个devin-key不仅可以免费用它的fast-context，还可以免费使用它的web-search，使用这个速度相对要快很多；
ps:在piwin里，code-search是跟grep、read等同一级别的工具；

## 与Ultra Code的关系
讲道理，我不知道，本质上原理差不多，ultra code简单点，code_search更结构化，ultra code就特娘的派个scout出去查下代码关系，然后返回给主代理，很大程度上也是避免了上下文污染，外援支持![image.png](https://img.yorickjue.com/file/1789909107239_image.png)
